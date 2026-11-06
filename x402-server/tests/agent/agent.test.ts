import { afterEach, describe, expect, it, vi } from 'vitest'
import { HEDERA_TESTNET_CAIP2 } from '@x402/hedera'
import { createApp } from '../../app'
import { testEnv } from '../helpers'
import { SpendLedger, type SpendPolicy, type SpendRequest } from '../../../agent/src/policy'
import { planCalls, tickersIn, type CatalogEntry } from '../../../agent/src/planner'
import { runAgent, type AgentDeps } from '../../../agent/src/run'
import { AuditPublisher } from '../../../lib/hedera/hcs'
import { decodeAuditMessage, type AuditSpend } from '../../../lib/hedera/audit'
import { agentRegistryId, erc8004Config, type AgentProfile } from '../../../lib/evm/erc8004'

const policy: SpendPolicy = {
  budgetUsd: 1, maxPerCallUsd: 0.5, perMerchantUsd: 1, approvalAboveUsd: 0.25, allowedPayTo: [], requireIdentity: true,
}
const base: SpendRequest = {
  merchant: 'm', operationId: 'op', payTo: '0.0.1001', asset: '0.0.0', amount: 50n, advertisedAmount: 50n,
  usd: 0.1, advertisedPayTo: '0.0.1001', identityVerified: true,
}

describe('agent spending policy', () => {
  it('allows a call within every limit', () => {
    expect(new SpendLedger(policy).evaluate(base).decision).toBe('allow')
  })
  it.each([
    [{ identityVerified: false }, 'ERC-8004'],
    [{ payTo: '0.0.6666' }, 'not allowlisted'],
    [{ amount: 51n }, 'discovery advertised'],
    [{ usd: 0.6 }, 'per-call cap'],
  ])('denies %o', (patch, reason) => {
    const v = new SpendLedger(policy).evaluate({ ...base, ...patch })
    expect(v.decision).toBe('deny')
    expect(v.reason).toContain(reason)
  })
  it('enforces the total budget and per-merchant caps', () => {
    const ledger = new SpendLedger({ ...policy, perMerchantUsd: 0.25 })
    ledger.record('m', 0.2)
    expect(ledger.evaluate({ ...base, usd: 0.1 }).reason).toContain('per-merchant')
    const tight = new SpendLedger({ ...policy, budgetUsd: 0.15 })
    tight.record('x', 0.1)
    expect(tight.evaluate(base).reason).toContain('remaining budget')
  })
  it('asks a human above the approval threshold', () => {
    expect(new SpendLedger(policy).evaluate({ ...base, usd: 0.3 }).decision).toBe('approve')
  })
  it('uses an explicit payTo allowlist over the advertised one', () => {
    const ledger = new SpendLedger({ ...policy, allowedPayTo: ['0.0.2002'] })
    expect(ledger.evaluate(base).decision).toBe('deny')
    expect(ledger.evaluate({ ...base, payTo: '0.0.2002' }).decision).toBe('allow')
  })
})

describe('agent planner', () => {
  const catalog: CatalogEntry[] = [
    { operationId: 'onchain.hederaNetworkSupply', method: 'GET', path: '/s', price: '$0.10', description: 'Network HBAR supply' },
    { operationId: 'onchain.hederaNetworkNodes', method: 'GET', path: '/n', price: '$0.15', description: 'Network node snapshot' },
    { operationId: 'market.quotes', method: 'GET', path: '/q', price: '$0.15', description: 'Bounded crypto spot quotes', requestExample: { symbols: ['BTC'] } },
    { operationId: 'ai.chat', method: 'POST', path: '/c', price: '$4.00', description: 'AI analyst chat' },
  ]
  it('picks relevant operations within budget and substitutes tickers', () => {
    const plan = planCalls('HBAR market + network health brief', catalog, { budgetUsd: 1 })
    expect(plan.map((p) => p.operationId)).toEqual(expect.arrayContaining(['onchain.hederaNetworkSupply', 'onchain.hederaNetworkNodes', 'market.quotes']))
    expect(plan.find((p) => p.operationId === 'market.quotes')?.input).toEqual({ symbols: ['HBAR'] })
    expect(plan.some((p) => p.operationId === 'ai.chat')).toBe(false)
  })
  it('respects --only and the budget', () => {
    expect(planCalls('anything', catalog, { budgetUsd: 0.12, only: ['onchain.hederaNetworkSupply', 'market.quotes'] }).map((p) => p.operationId)).toEqual(['onchain.hederaNetworkSupply'])
    expect(tickersIn('HBAR and USD via HCS')).toEqual(['HBAR'])
  })
})

describe('agent end-to-end against the merchant (Blocky402 mocked)', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubFacilitator() {
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input)
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url.endsWith('/supported')) return json({ kinds: [{ x402Version: 2, scheme: 'exact', network: HEDERA_TESTNET_CAIP2, extra: { feePayer: '0.0.7162784' } }], extensions: [], signers: {} })
      if (url.endsWith('/verify')) return json({ isValid: true, payer: '0.0.5005' })
      if (url.endsWith('/settle')) return json({ success: true, transaction: `0.0.7162784@1700000000.00000000${++n}`, network: HEDERA_TESTNET_CAIP2, payer: '0.0.5005' })
      throw new Error(`Unexpected request ${url}`)
    }))
  }

  const evm = erc8004Config('hedera-testnet')!
  const identityProfile: AgentProfile = {
    agentId: '144', agentRegistry: agentRegistryId(evm), owner: '0xBB168355570708002DFe73743AE2E068e298Ca98', wallet: null, uri: '',
    registration: {
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1', name: 'Finality', description: '', services: [],
      x402Support: true, active: true, registrations: [{ agentId: 144, agentRegistry: agentRegistryId(evm) }], supportedTrust: ['reputation'],
    },
    reputation: { clients: 0, count: 0, average: null },
  }

  function setup(approve: boolean) {
    stubFacilitator()
    const merchantEnv = { ...testEnv, X402_PUBLIC_URL: 'http://merchant.test', ERC8004_MERCHANT_AGENT_ID: '144' }
    const app = createApp(merchantEnv, { audit: null })
    const submitted: string[] = []
    const audit = new AuditPublisher('0.0.9001', async (_t, m) => { submitted.push(m); return { sequenceNumber: String(submitted.length), transactionId: 'x' } }, { logger: () => {} })
    const feedback = vi.fn(async () => '0xfeedback')
    const deps: AgentDeps = {
      // The x402 fetch wrapper retries with a Request object carrying PAYMENT-SIGNATURE; pass it through intact.
      fetch: ((input: string | URL | Request, init?: RequestInit) =>
        input instanceof Request ? app.request(input) : app.request(String(input), init)) as typeof fetch,
      signer: { accountId: '0.0.5005', createPartiallySignedTransferTransaction: async () => Buffer.from('tx').toString('base64') } as any,
      caip2: HEDERA_TESTNET_CAIP2,
      agentLabel: `${agentRegistryId(evm)}#145`,
      readIdentity: async () => identityProfile,
      audit,
      feedback,
      approve: async () => approve,
      log: () => {},
    }
    const spends = () => submitted.map((m) => decodeAuditMessage(Buffer.from(m).toString('base64')) as AuditSpend)
    return { deps, spends, feedback }
  }

  it('discovers, pays within policy, audits every decision and leaves feedback', async () => {
    const { deps, spends, feedback } = setup(false)
    const report = await runAgent(
      { merchant: 'http://merchant.test', goal: 'HBAR network health', asset: 'HBAR', policy: { ...policy, approvalAboveUsd: 0.12 }, only: ['onchain.hederaNetworkSupply', 'onchain.hederaNetworkNodes', 'market.quotes'] },
      deps,
    )
    expect(report.identityVerified).toBe(true)
    const byOp = Object.fromEntries(report.results.map((r) => [r.operationId, r]))
    expect(byOp['onchain.hederaNetworkSupply']).toMatchObject({ decision: 'paid', amount: '50000000' })
    expect(byOp['onchain.hederaNetworkSupply'].paymentTx).toMatch(/^0\.0\.7162784@/)
    expect(byOp['onchain.hederaNetworkSupply'].sha256).toMatch(/^[0-9a-f]{64}$/)
    // $0.15 > $0.12 approval threshold and the human declines → skipped, not paid
    expect(byOp['onchain.hederaNetworkNodes']).toMatchObject({ decision: 'skipped' })
    expect(report.spentUsd).toBe(0.1)
    expect(feedback).toHaveBeenCalledWith(expect.objectContaining({ agentId: 144n, score: 60, tag1: 'x402', tag2: 'onchain.hederaNetworkSupply' }))
    const records = spends()
    expect(records.every((r) => r.type === 'spend' && r.agent.endsWith('#145'))).toBe(true)
    expect(records.find((r) => r.op === 'onchain.hederaNetworkSupply')).toMatchObject({ decision: 'paid', asset: '0.0.0', amount: '50000000', payTo: '0.0.1001' })
    expect(records.find((r) => r.op === 'onchain.hederaNetworkNodes')).toMatchObject({ decision: 'skipped' })
  })

  it('refuses to pay a merchant whose ERC-8004 identity does not verify', async () => {
    const { deps, spends, feedback } = setup(true)
    deps.readIdentity = async () => null
    const report = await runAgent(
      { merchant: 'http://merchant.test', goal: 'supply', asset: 'HBAR', policy, only: ['onchain.hederaNetworkSupply'] },
      deps,
    )
    expect(report.results[0]).toMatchObject({ decision: 'denied', paymentTx: null })
    expect(report.spentUsd).toBe(0)
    expect(feedback).not.toHaveBeenCalled()
    expect(spends()[0]).toMatchObject({ decision: 'denied', reason: 'merchant has no verified ERC-8004 identity' })
  })
})
