/**
 * Register (or refresh) an ERC-8004 agent identity on Hedera EVM.
 *
 *   npm run erc8004:register -- merchant   # Finality, owned by MERCHANT_OPERATOR_KEY → ERC8004_MERCHANT_AGENT_ID
 *   npm run erc8004:register -- agent      # research agent, owned by X402_TEST_PAYER_PRIVATE_KEY → ERC8004_AGENT_ID
 *
 * The registration file is stored on-chain as a data: URI (allowed by ERC-8004), so it is verifiable without any
 * hosting. If the stored agentId is already owned by this key, only the URI is refreshed (no duplicate identities).
 * Keys must be ECDSA (the same key controls the Hedera account 0.0.x and its EVM alias 0x…).
 */
import { privateKeyToAccount } from 'viem/accounts'
import {
  agentRegistryId,
  buildRegistrationFile,
  erc8004Config,
  identityRegistryAbi,
  publicClientFor,
  registerAgent,
  toViemPrivateKey,
  updateAgentUri,
  type Erc8004Network,
} from '../lib/evm/erc8004'
import { PLATFORM } from '../x402-server/discovery/platform'

type Role = 'merchant' | 'agent'

function env(name: string) {
  const v = process.env[name]?.trim()
  return v ? v : undefined
}

async function main() {
  const role = (process.argv[2] ?? '') as Role
  if (role !== 'merchant' && role !== 'agent') throw new Error('Usage: npm run erc8004:register -- merchant|agent')
  const network = (env('X402_NETWORK') ?? 'hedera-testnet') as Erc8004Network
  const config = erc8004Config(network, {
    rpcUrl: env('EVM_RPC_URL'),
    identityRegistry: env('ERC8004_IDENTITY_REGISTRY'),
    reputationRegistry: env('ERC8004_REPUTATION_REGISTRY'),
  })
  if (!config) throw new Error(`No ERC-8004 registries known for ${network}; set ERC8004_IDENTITY_REGISTRY/REPUTATION_REGISTRY`)

  const keyVar = role === 'merchant' ? 'MERCHANT_OPERATOR_KEY' : 'X402_TEST_PAYER_PRIVATE_KEY'
  const idVar = role === 'merchant' ? 'ERC8004_MERCHANT_AGENT_ID' : 'ERC8004_AGENT_ID'
  const accountVar = role === 'merchant' ? 'MERCHANT_OPERATOR_ID' : 'X402_TEST_PAYER_ACCOUNT_ID'
  const key = env(keyVar)
  if (!key) throw new Error(`Set ${keyVar}`)
  const owner = privateKeyToAccount(toViemPrivateKey(key)).address
  const api = PLATFORM.apiBase
  const slug = network === 'hedera-mainnet' ? 'mainnet' : 'testnet'
  const auditTopic = env('HCS_AUDIT_TOPIC_ID')

  const makeFile = (agentId: bigint | null) =>
    role === 'merchant'
      ? buildRegistrationFile({
          name: PLATFORM.name,
          description: `${PLATFORM.description} Settles on Hedera via Blocky402; every sale is logged to HCS.`,
          image: `${PLATFORM.website}${PLATFORM.logoPath}`,
          services: [
            { name: 'web', endpoint: PLATFORM.website },
            { name: 'x402', endpoint: `${api}/.well-known/x402` },
            { name: 'OpenAPI', endpoint: `${api}/v1/openapi.json`, version: '3.1.0' },
            ...(auditTopic ? [{ name: 'HCS audit', endpoint: `https://hashscan.io/${slug}/topic/${auditTopic}` }] : []),
          ],
          x402Support: true,
          agentId,
          agentRegistry: agentRegistryId(config),
        })
      : buildRegistrationFile({
          name: 'Finality Research Agent',
          description:
            'Autonomous research agent: discovers x402 services, buys data within a spending policy, pays on Hedera, and logs every spend to HCS.',
          services: [
            ...(env('X402_TEST_PAYER_ACCOUNT_ID')
              ? [{ name: 'Hedera account', endpoint: `https://hashscan.io/${slug}/account/${env('X402_TEST_PAYER_ACCOUNT_ID')}` }]
              : []),
            ...(auditTopic ? [{ name: 'HCS audit', endpoint: `https://hashscan.io/${slug}/topic/${auditTopic}` }] : []),
          ],
          x402Support: true,
          agentId,
          agentRegistry: agentRegistryId(config),
        })

  const existing = env(idVar)
  const client = publicClientFor(config)
  if (existing) {
    const currentOwner = await client
      .readContract({ address: config.identityRegistry, abi: identityRegistryAbi, functionName: 'ownerOf', args: [BigInt(existing)] })
      .catch(() => null)
    if (currentOwner?.toLowerCase() === owner.toLowerCase()) {
      const hash = await updateAgentUri(config, key, BigInt(existing), makeFile(BigInt(existing)))
      console.log(`Refreshed ${role} agent #${existing} registration (${env(accountVar) ?? owner})`)
      console.log(`setAgentURI tx ${hash}`)
      return
    }
    console.warn(`${idVar}=${existing} is not owned by ${owner}; registering a new identity`)
  }

  console.log(`Registering ${role} (${env(accountVar) ?? ''} / ${owner}) in ${agentRegistryId(config)} …`)
  const result = await registerAgent(config, key, makeFile)
  console.log(`Registered ${role} as ERC-8004 agent #${result.agentId}`)
  console.log(`register tx    ${result.registerHash}`)
  console.log(`setAgentURI tx ${result.uriHash}`)
  console.log(`Owner on HashScan: https://hashscan.io/${slug}/account/${owner}`)
  console.log(`\nAdd to .env:\n${idVar}=${result.agentId}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
