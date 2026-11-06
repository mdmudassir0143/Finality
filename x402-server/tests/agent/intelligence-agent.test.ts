import { afterEach, describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { Client, PrivateKey } from '@hiero-ledger/sdk'
import { HEDERA_TESTNET_CAIP2 } from '@x402/hedera'
import { createApp } from '../../app'
import { testEnv } from '../helpers'
import { MerchantSession, type AgentDeps } from '../../../agent/src/session'
import { AuditPublisher } from '../../../lib/hedera/hcs'
import { decodeAuditMessage, type AuditSpend } from '../../../lib/hedera/audit'
import { agentRegistryId, erc8004Config, type AgentProfile } from '../../../lib/evm/erc8004'
import { runSpec } from '../../../agents/core/runner'
import { intelligenceAgent } from '../../../agents/specs/intelligence'
import { citationsIn } from '../../../agents/core/trace'

/** Scripted model: each doGenerate call returns the next turn (tool calls, then the final brief). */
function scriptedModel(turns: Array<{ calls?: Array<{ name: string; input: Record<string, unknown> }>; text?: string }>) {
  let i = 0
  const usage = { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } }
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const turn = turns[Math.min(i++, turns.length - 1)]
      if (turn.calls?.length) {
        return {
          content: turn.calls.map((c, n) => ({ type: 'tool-call' as const, toolCallId: `call-${i}-${n}`, toolName: c.name, input: JSON.stringify(c.input) })),
          finishReason: { unified: 'tool-calls' as const, raw: 'tool_calls' },
          usage,
          warnings: [],
        }
      }
      return { content: [{ type: 'text' as const, text: turn.text ?? '' }], finishReason: { unified: 'stop' as const, raw: 'stop' }, usage, warnings: [] }
    },
  })
}

describe('Intelligence agent (AI SDK + Hedera Agent Kit + Finality plugin)', () => {
  afterEach(() => vi.unstubAllGlobals())

  async function openSession(budgetUsd = 0.3) {
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input)
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url.endsWith('/supported')) return json({ kinds: [{ x402Version: 2, scheme: 'exact', network: HEDERA_TESTNET_CAIP2, extra: { feePayer: '0.0.7162784' } }], extensions: [], signers: {} })
      if (url.endsWith('/verify')) return json({ isValid: true, payer: '0.0.5005' })
      if (url.endsWith('/settle')) return json({ success: true, transaction: `0.0.7162784@1700000000.00000000${++n}`, network: HEDERA_TESTNET_CAIP2, payer: '0.0.5005' })
      throw new Error(`Unexpected request ${url}`)
    }))
    const app = createApp({ ...testEnv, X402_PUBLIC_URL: 'http://merchant.test', ERC8004_MERCHANT_AGENT_ID: '144' }, { audit: null })
    const evm = erc8004Config('hedera-testnet')!
    const profile: AgentProfile = {
      agentId: '144', agentRegistry: agentRegistryId(evm), owner: '0xBB168355570708002DFe73743AE2E068e298Ca98', wallet: null, uri: '',
      registration: {
        type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1', name: 'Finality', description: '', services: [],
        x402Support: true, active: true, registrations: [{ agentId: 144, agentRegistry: agentRegistryId(evm) }], supportedTrust: ['reputation'],
      },
      reputation: { clients: 0, count: 0, average: null },
    }
    const submitted: string[] = []
    const audit = new AuditPublisher('0.0.9001', async (_t, m) => { submitted.push(m); return { sequenceNumber: '1', transactionId: 'x' } }, { logger: () => {} })
    const deps: AgentDeps = {
      fetch: ((i: string | URL | Request, init?: RequestInit) => (i instanceof Request ? app.request(i) : app.request(String(i), init))) as typeof fetch,
      signer: { accountId: '0.0.5005', createPartiallySignedTransferTransaction: async () => Buffer.from('tx').toString('base64') } as any,
      caip2: HEDERA_TESTNET_CAIP2,
      agentLabel: 'hcs11:intelligence',
      readIdentity: async () => profile,
      audit,
      approve: async () => false,
      log: () => {},
    }
    const session = await MerchantSession.open(
      { merchant: 'http://merchant.test', asset: 'HBAR', policy: { budgetUsd, maxPerCallUsd: 0.2, perMerchantUsd: budgetUsd, approvalAboveUsd: 1, allowedPayTo: [], requireIdentity: true } },
      deps,
    )
    const spends = () => submitted.map((m) => decodeAuditMessage(Buffer.from(m).toString('base64')) as AuditSpend)
    return { session, spends }
  }

  const client = () => Client.forTestnet().setOperator('0.0.5005', PrivateKey.generateECDSA())

  it('browses the catalog, buys one endpoint under policy, and cites it', async () => {
    const { session, spends } = await openSession()
    const model = scriptedModel([
      { calls: [{ name: 'finality_catalog_tool', input: {} }] },
      { calls: [{ name: 'finality_call_tool', input: { operationId: 'onchain.hederaNetworkSupply' } }] },
      { text: '## Answer\nHBAR supply data was retrieved [S1].\n## Findings\n- Supply fetched [S1]\n## Caveats\n- none' },
    ])
    const trace = await runSpec({ spec: intelligenceAgent, goal: 'What is the HBAR supply?', model, modelId: 'mock', client: client(), accountId: '0.0.5005', network: 'hedera-testnet', session })
    await session.close()

    expect(trace.error).toBeUndefined()
    expect(trace.steps).toBe(3)
    expect(trace.toolCalls.map((c) => c.tool)).toEqual(['finality_catalog_tool', 'finality_call_tool'])
    expect(trace.toolCalls[0]).toMatchObject({ kind: 'meta', sourceId: null, ok: true })
    expect(trace.toolCalls[1]).toMatchObject({ kind: 'finality', sourceId: 'S1', ok: true })
    expect(trace.toolCalls[1].payment).toMatchObject({ operationId: 'onchain.hederaNetworkSupply', decision: 'paid', usd: 0.1 })
    expect(trace.toolCalls[1].payment?.tx).toMatch(/^0\.0\.7162784@/)
    expect(trace.spentUsd).toBe(0.1)
    expect(trace.usage.totalTokens).toBe(360)
    expect(citationsIn(trace.text)).toEqual(['S1'])
    expect(trace.unknownCitations).toEqual([])
    expect(spends().find((s) => s.op === 'onchain.hederaNetworkSupply')).toMatchObject({ decision: 'paid', agent: 'hcs11:intelligence' })
  })

  it('cannot overspend: a purchase past the budget is denied, not paid, and invented citations are flagged', async () => {
    const { session } = await openSession(0.1)
    const model = scriptedModel([
      { calls: [{ name: 'finality_call_tool', input: { operationId: 'onchain.hederaNetworkSupply' } }] },
      { calls: [{ name: 'finality_call_tool', input: { operationId: 'market.quotes', input: '{"symbols":["HBAR"]}' } }] },
      { text: 'Supply [S1], price [S2], and [S9].' },
    ])
    const trace = await runSpec({ spec: intelligenceAgent, goal: 'HBAR supply and price', model, modelId: 'mock', client: client(), accountId: '0.0.5005', network: 'hedera-testnet', session })
    expect(trace.toolCalls[0]).toMatchObject({ ok: true, sourceId: 'S1' })
    expect(trace.toolCalls[1]).toMatchObject({ ok: false, sourceId: null })
    expect(trace.toolCalls[1].payment?.decision).toBe('denied')
    expect(trace.spentUsd).toBe(0.1)
    expect(trace.unknownCitations).toEqual(['S2', 'S9'])
  })

  it('rejects bad tool input without paying', async () => {
    const { session } = await openSession()
    const model = scriptedModel([
      { calls: [{ name: 'finality_call_tool', input: { operationId: 'does.not.exist' } }] },
      { calls: [{ name: 'finality_call_tool', input: { operationId: 'market.quotes', input: 'not json' } }] },
      { text: 'No data.' },
    ])
    const trace = await runSpec({ spec: intelligenceAgent, goal: 'x', model, modelId: 'mock', client: client(), accountId: '0.0.5005', network: 'hedera-testnet', session })
    expect(trace.toolCalls.every((c) => !c.ok && !c.payment)).toBe(true)
    expect(trace.spentUsd).toBe(0)
  })
})

describe('discovery with more than one payment rail', () => {
  it('keeps the native payee when the merchant also advertises the fUSD EVM rail', async () => {
    const { discoverMerchant } = await import('../../../agent/src/discovery')
    const app = createApp(
      { ...testEnv, X402_PUBLIC_URL: 'http://merchant.test', X402_EVM_FACILITATOR_URL: 'http://evm-facilitator.test', X402_EVM_PAYTO_ADDRESS: '0x153cc53c83394e6971b26d900d08fef7ae9568e8' },
      { audit: null },
    )
    const fetchFn = ((i: string | URL | Request, init?: RequestInit) => app.request(String(i), init)) as typeof fetch
    const d = await discoverMerchant('http://merchant.test', fetchFn)
    expect(d.payTo).toBe(testEnv.X402_PAYTO_ADDRESS)
  })
})
