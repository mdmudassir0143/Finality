import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { Client, PrivateKey } from '@hiero-ledger/sdk'
import { HEDERA_MAINNET_CAIP2, HEDERA_TESTNET_CAIP2, createClientHederaSigner } from '@x402/hedera'
import { agentRegistryId, erc8004Config, giveFeedback, readAgent, type Erc8004Network } from '../../lib/evm/erc8004'
import { AuditPublisher, createOperatorClient, sdkSubmitter } from '../../lib/hedera/hcs'
import { parseHederaPrivateKey } from '../../lib/hedera/keys'
import { MerchantSession, type AgentDeps, type Asset } from '../../agent/src/session'
import type { AgentSpec } from './spec'

export const env = (name: string) => process.env[name]?.trim() || undefined

/** HCS-11 registry entry written by `npm run agents -- provision <id>` (public data only; keys stay in .env). */
export type RegistryEntry = {
  id: string
  name: string
  accountId: string
  inboundTopicId: string
  outboundTopicId: string
  profileTopicId?: string
  createdAt: string
}

export function registryPath(network: string) {
  return path.join(process.cwd(), 'agents', 'registry', `${network}.json`)
}

export function readRegistry(network: string): Record<string, RegistryEntry> {
  const file = registryPath(network)
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, RegistryEntry>) : {}
}

/** AGENT_<ID>_… env prefix for an agent id, e.g. intelligence → AGENT_INTELLIGENCE. */
export const envPrefix = (id: string) => `AGENT_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`

/**
 * The Hedera account an agent acts as: its own HCS-11-provisioned account (AGENT_<ID>_ACCOUNT_ID / _PRIVATE_KEY)
 * when present, else the shared test payer. Returns where the identity came from for the run header.
 */
export function agentAccount(spec: AgentSpec): { accountId: string; key: string; source: string } {
  const prefix = envPrefix(spec.id)
  const own = { accountId: env(`${prefix}_ACCOUNT_ID`), key: env(`${prefix}_PRIVATE_KEY`) }
  if (own.accountId && own.key) return { accountId: own.accountId, key: own.key, source: `HCS-11 account (${prefix}_*)` }
  const accountId = env('X402_TEST_PAYER_ACCOUNT_ID')
  const key = env('X402_TEST_PAYER_PRIVATE_KEY')
  if (!accountId || !key) throw new Error(`No account for ${spec.id}: provision it (npm run agents -- provision ${spec.id}) or set X402_TEST_PAYER_ACCOUNT_ID/_PRIVATE_KEY`)
  return { accountId, key, source: 'shared test payer (X402_TEST_PAYER_*)' }
}

export type RunContext = {
  network: Erc8004Network
  slug: 'testnet' | 'mainnet'
  client: Client
  session?: MerchantSession
  accountId: string
  accountSource: string
  agentLabel: string
  audit: AuditPublisher | null
  close: () => Promise<void>
}

/**
 * Wire everything a live run needs: the agent's Hedera client, and (for Finality buyers) an x402 MerchantSession
 * with the spend policy, HCS spend records and ERC-8004 feedback — the same wiring as the deterministic agent.
 */
export async function openRunContext(
  spec: AgentSpec,
  opts: {
    merchant: string
    budgetUsd: number
    maxPerCallUsd: number
    approvalAboveUsd: number
    asset: Asset
    requireIdentity: boolean
    audit: boolean
    feedback: boolean
    approve: (question: string) => Promise<boolean>
    log: (line: string) => void
  },
): Promise<RunContext> {
  const network = (env('X402_NETWORK') ?? 'hedera-testnet') as Erc8004Network
  const slug = network === 'hedera-mainnet' ? 'mainnet' : 'testnet'
  const caip2 = network === 'hedera-mainnet' ? HEDERA_MAINNET_CAIP2 : HEDERA_TESTNET_CAIP2
  const { accountId, key, source } = agentAccount(spec)
  const parsedKey: PrivateKey = parseHederaPrivateKey(key)
  const client = (network === 'hedera-mainnet' ? Client.forMainnet() : Client.forTestnet()).setOperator(accountId, parsedKey)

  const evm = erc8004Config(network, { rpcUrl: env('EVM_RPC_URL'), identityRegistry: env('ERC8004_IDENTITY_REGISTRY'), reputationRegistry: env('ERC8004_REPUTATION_REGISTRY') })
  const registry = readRegistry(network)[spec.id]
  const erc8004Id = spec.id === 'intelligence' ? env('ERC8004_AGENT_ID') : undefined
  const agentLabel = registry ? `hcs11:${registry.accountId}:${spec.id}` : evm && erc8004Id ? `${agentRegistryId(evm)}#${erc8004Id}` : `hedera:${slug}:${accountId}`

  const auditTopic = env('HCS_AUDIT_TOPIC_ID')
  const hcsClient = opts.audit && auditTopic ? createOperatorClient({ network, operatorId: accountId, operatorKey: key }) : null
  const audit = hcsClient && auditTopic ? new AuditPublisher(auditTopic, sdkSubmitter(hcsClient), { logger: () => {} }) : null

  let session: MerchantSession | undefined
  if (spec.finality) {
    const deps: AgentDeps = {
      fetch: globalThis.fetch,
      signer: createClientHederaSigner(accountId, parsedKey, { network: caip2 }),
      caip2,
      agentLabel,
      readIdentity: evm ? async (identity) => readAgent(evm, BigInt(identity.agentId)) : undefined,
      audit,
      // ERC-8004 feedback is an EVM transaction from the agent's key; only ECDSA keys have an EVM address.
      feedback: evm && opts.feedback ? async (input) => giveFeedback(evm, key, input) : undefined,
      approve: opts.approve,
      log: opts.log,
    }
    session = await MerchantSession.open(
      {
        merchant: opts.merchant,
        asset: opts.asset,
        policy: {
          budgetUsd: opts.budgetUsd,
          maxPerCallUsd: opts.maxPerCallUsd,
          perMerchantUsd: opts.budgetUsd,
          approvalAboveUsd: opts.approvalAboveUsd,
          allowedPayTo: [],
          requireIdentity: opts.requireIdentity,
        },
      },
      deps,
    )
  }

  return {
    network,
    slug,
    client,
    session,
    accountId,
    accountSource: source,
    agentLabel,
    audit,
    close: async () => {
      await session?.close()
      hcsClient?.close()
      client.close()
    },
  }
}
