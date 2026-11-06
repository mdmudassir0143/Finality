/**
 * HCS-11 agent identity (pattern from Hedera-By-Example M09-04; standards at hol.org/docs/standards).
 *
 *   npm run agents -- provision intelligence [--no-registry]
 *
 * Steps, each persisted so a failed run resumes instead of starting over:
 *  1. account   new ECDSA account for the agent, funded by MERCHANT_OPERATOR_ID; its key is appended to .env
 *               (AGENT_<ID>_ACCOUNT_ID / _PRIVATE_KEY) immediately, before anything else can fail
 *  2. topics    HCS-10 inbound (public, memo hcs-10:0:60:0:<account>) and outbound (agent-only, hcs-10:0:60:1)
 *  3. profile   HCS-11 AI-agent profile written as an HCS-1 file (submit key = agent, no admin key)
 *  4. memo      account memo hcs-11:hcs://1/<profileTopic>
 *  5. verify    read memo + profile back from the Mirror Node and check the HCS-1 hash
 *  6. registry  optional: register in the public Hashgraph Online guarded registry (HCS-10)
 * The profile is written directly to Hedera (Node's built-in zstd); no inscription service is involved.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  AccountCreateTransaction,
  AccountUpdateTransaction,
  Client,
  Hbar,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
} from '@hiero-ledger/sdk'
import { AIAgentCapability, AIAgentType, HCS10Client, HCS11Client } from '@hashgraphonline/standards-sdk'
import { parseHederaPrivateKey } from '../../lib/hedera/keys'
import { getAgent } from '../specs'
import { env, envPrefix, readRegistry, registryPath, type RegistryEntry } from './env'
import { decodeHcs1, encodeHcs1 } from './hcs1'
import type { AgentCapability } from './spec'

const CAPABILITY: Record<AgentCapability, AIAgentCapability> = {
  TEXT_GENERATION: AIAgentCapability.TEXT_GENERATION,
  DATA_INTEGRATION: AIAgentCapability.DATA_INTEGRATION,
  MARKET_INTELLIGENCE: AIAgentCapability.MARKET_INTELLIGENCE,
  TRANSACTION_ANALYTICS: AIAgentCapability.TRANSACTION_ANALYTICS,
  KNOWLEDGE_RETRIEVAL: AIAgentCapability.KNOWLEDGE_RETRIEVAL,
}

/** HBAR for the agent account: HCS messages, native x402 HBAR payments and benchmark runs. */
const INITIAL_HBAR = 30
const TTL = 60
const MIRROR = 'https://testnet.mirrornode.hedera.com'

type Progress = Partial<RegistryEntry> & { stage?: string }

function save(network: string, id: string, entry: Progress) {
  const registry = readRegistry(network) as Record<string, Progress>
  registry[id] = { ...registry[id], ...entry }
  mkdirSync(path.dirname(registryPath(network)), { recursive: true })
  writeFileSync(registryPath(network), JSON.stringify(registry, null, 2) + '\n')
}

async function mirror<T>(pathname: string): Promise<T> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await fetch(`${MIRROR}${pathname}`)
    if (res.ok) return (await res.json()) as T
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error(`Mirror Node ${pathname} unavailable`)
}

export async function cmdProvision(id: string, opts: { registry?: boolean } = {}) {
  const spec = getAgent(id)
  const network = env('X402_NETWORK') ?? 'hedera-testnet'
  if (network !== 'hedera-testnet') throw new Error('Provisioning is testnet-only for now')
  const existing = (readRegistry(network) as Record<string, Progress>)[spec.id] ?? {}
  if (existing.stage === 'complete') {
    console.log(`${spec.id} is already provisioned: ${existing.accountId} (profile ${existing.profileTopicId})`)
    return
  }
  const operatorId = env('MERCHANT_OPERATOR_ID')
  const operatorKey = env('MERCHANT_OPERATOR_KEY')
  if (!operatorId || !operatorKey) throw new Error('Set MERCHANT_OPERATOR_ID and MERCHANT_OPERATOR_KEY (pays for the agent account and topics)')
  const client = Client.forTestnet().setOperator(operatorId, parseHederaPrivateKey(operatorKey))
  const prefix = envPrefix(spec.id)

  try {
    // 1. account (key persisted before any other step)
    let accountId = env(`${prefix}_ACCOUNT_ID`)
    let agentKey: PrivateKey
    if (accountId && env(`${prefix}_PRIVATE_KEY`)) {
      agentKey = parseHederaPrivateKey(env(`${prefix}_PRIVATE_KEY`)!)
      console.log(`1/6 account   ${accountId} (from .env)`)
    } else {
      agentKey = PrivateKey.generateECDSA()
      const receipt = await (
        await new AccountCreateTransaction().setKeyWithoutAlias(agentKey.publicKey).setInitialBalance(new Hbar(INITIAL_HBAR)).setAccountMemo('').execute(client)
      ).getReceipt(client)
      accountId = receipt.accountId!.toString()
      appendFileSync('.env', `\n# ${spec.name}: HCS-11 agent account (npm run agents -- provision ${spec.id})\n${prefix}_ACCOUNT_ID=${accountId}\n${prefix}_PRIVATE_KEY=${agentKey.toStringDer()}\n`)
      process.env[`${prefix}_ACCOUNT_ID`] = accountId
      process.env[`${prefix}_PRIVATE_KEY`] = agentKey.toStringDer()
      console.log(`1/6 account   ${accountId} created with ${INITIAL_HBAR} HBAR; key saved to .env as ${prefix}_PRIVATE_KEY (not printed)`)
    }
    save(network, spec.id, { id: spec.id, name: spec.name, accountId, stage: 'account', createdAt: existing.createdAt ?? new Date().toISOString() })

    // 2. HCS-10 topics
    let { inboundTopicId, outboundTopicId } = existing
    if (!inboundTopicId) {
      const tx = await new TopicCreateTransaction().setTopicMemo(`hcs-10:0:${TTL}:0:${accountId}`).setAdminKey(agentKey.publicKey).freezeWith(client).sign(agentKey)
      inboundTopicId = (await (await tx.execute(client)).getReceipt(client)).topicId!.toString()
      save(network, spec.id, { inboundTopicId, stage: 'inbound' })
    }
    if (!outboundTopicId) {
      const tx = await new TopicCreateTransaction()
        .setTopicMemo(`hcs-10:0:${TTL}:1`)
        .setAdminKey(agentKey.publicKey)
        .setSubmitKey(agentKey.publicKey)
        .freezeWith(client)
        .sign(agentKey)
      outboundTopicId = (await (await tx.execute(client)).getReceipt(client)).topicId!.toString()
      save(network, spec.id, { outboundTopicId, stage: 'outbound' })
    }
    console.log(`2/6 topics    inbound ${inboundTopicId} · outbound ${outboundTopicId}`)

    // 3. HCS-11 profile as an HCS-1 file
    let { profileTopicId } = existing
    if (!profileTopicId) {
      const hcs11 = new HCS11Client({ network: 'testnet', auth: { operatorId, privateKey: operatorKey }, silent: true, keyType: 'ecdsa' })
      const profile = hcs11.createAIAgentProfile(spec.name, AIAgentType.AUTONOMOUS, spec.capabilities.map((c) => CAPABILITY[c]), spec.model ?? env('GEMINI_MODEL') ?? 'gemini', {
        alias: `finality-${spec.id}`,
        bio: spec.bio,
        inboundTopicId,
        outboundTopicId,
        creator: 'Finality',
        properties: { framework: 'hedera-agent-kit + vercel-ai-sdk', merchant: 'Finality x402', agentSpec: spec.id },
      })
      const check = hcs11.validateProfile(profile)
      if (!check.valid) throw new Error(`Invalid HCS-11 profile: ${check.errors.join('; ')}`)
      const file = encodeHcs1(hcs11.profileToJSONString(profile), 'application/json')
      const create = await new TopicCreateTransaction().setTopicMemo(file.memo).setSubmitKey(agentKey.publicKey).freezeWith(client).sign(agentKey)
      profileTopicId = (await (await create.execute(client)).getReceipt(client)).topicId!.toString()
      for (const message of file.messages) {
        const submit = await new TopicMessageSubmitTransaction().setTopicId(profileTopicId).setMessage(message).freezeWith(client).sign(agentKey)
        await (await submit.execute(client)).getReceipt(client)
      }
      save(network, spec.id, { profileTopicId, stage: 'profile' })
      console.log(`3/6 profile   HCS-1 topic ${profileTopicId} (${file.messages.length} chunk(s), memo ${file.memo.slice(0, 16)}…)`)
    } else console.log(`3/6 profile   ${profileTopicId} (existing)`)

    // 4. account memo → profile
    const memo = `hcs-11:hcs://1/${profileTopicId}`
    const update = await new AccountUpdateTransaction().setAccountId(accountId).setAccountMemo(memo).freezeWith(client).sign(agentKey)
    await (await update.execute(client)).getReceipt(client)
    save(network, spec.id, { stage: 'memo' })
    console.log(`4/6 memo      ${memo}`)

    // 5. verify from the Mirror Node
    const account = await mirror<{ memo: string }>(`/api/v1/accounts/${accountId}`)
    if (account.memo !== memo) throw new Error(`Account memo is "${account.memo}", expected "${memo}"`)
    const topic = await mirror<{ memo: string; admin_key: unknown; submit_key: unknown }>(`/api/v1/topics/${profileTopicId}`)
    if (topic.admin_key || !topic.submit_key) throw new Error('Profile topic must have a submit key and no admin key (HCS-1)')
    const msgs = await mirror<{ messages: Array<{ message: string }> }>(`/api/v1/topics/${profileTopicId}/messages?limit=100&order=asc`)
    const decoded = decodeHcs1(topic.memo, msgs.messages.map((m) => Buffer.from(m.message, 'base64').toString('utf8')))
    const profile = JSON.parse(decoded.content.toString('utf8')) as { display_name: string; inboundTopicId: string }
    if (profile.display_name !== spec.name || profile.inboundTopicId !== inboundTopicId) throw new Error('Profile read back does not match')
    save(network, spec.id, { stage: 'verified' })
    console.log(`5/6 verify    memo, HCS-1 hash and profile fields match on the Mirror Node`)

    // 6. public Hashgraph Online registry (optional)
    if (opts.registry === false) console.log('6/6 registry  skipped (--no-registry)')
    else {
      try {
        const hcs10 = new HCS10Client({ network: 'testnet', operatorId: accountId, operatorPrivateKey: agentKey.toStringRaw(), keyType: 'ecdsa', logLevel: 'error' })
        const res = await hcs10.registerAgentWithGuardedRegistry(accountId, 'testnet')
        console.log(`6/6 registry  ${res.success ? `registered in the Hashgraph Online registry${res.transactionId ? ` (${res.transactionId})` : ''}` : `not registered: ${res.error ?? 'unknown error'}`}`)
        save(network, spec.id, { stage: res.success ? 'complete' : 'verified' })
      } catch (error) {
        console.log(`6/6 registry  not registered: ${error instanceof Error ? error.message.split('\n')[0] : error}`)
      }
    }
    if ((readRegistry(network) as Record<string, Progress>)[spec.id]?.stage !== 'complete') save(network, spec.id, { stage: opts.registry === false ? 'complete' : 'verified' })

    console.log(`\n${spec.name}: https://hashscan.io/testnet/account/${accountId}`)
  } finally {
    client.close()
  }
}
