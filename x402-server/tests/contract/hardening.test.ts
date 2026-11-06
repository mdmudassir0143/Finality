import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { createApp } from '../../app'
import { testEnv } from '../helpers'
import { limits, limitsState, MAX_WINDOWS } from '../../middleware/limits'
import { cached, cacheSize, MAX_CACHE_ENTRIES } from '../../../lib/providers/cache'
import { executeOperation } from '../../services/operation'
import { createFacilitatorApp, sanitizeError, type FacilitatorCore } from '../../../facilitator/app'
import { SpendLedger, type SpendPolicy, type SpendRequest } from '../../../agent/src/policy'
import { planCalls } from '../../../agent/src/planner'
import { erc8004Config, type AgentProfile } from '../../../lib/evm/erc8004'

afterEach(() => { vi.unstubAllGlobals(); limitsState.reset() })

describe('rate-limit window map', () => {
  it('stays bounded under a flood of distinct client ids and still limits a single client', async () => {
    const app = new Hono()
    app.use('*', limits)
    app.get('/v1/market/quotes', c => c.text('ok'))
    for (let i = 0; i < MAX_WINDOWS + 500; i++) {
      await app.request('/v1/market/quotes', { headers: { 'x-forwarded-for': `10.0.${i >> 8}.${i & 255}-${i}` } })
    }
    expect(limitsState.windows).toBeLessThanOrEqual(MAX_WINDOWS)
    let last = 0
    for (let i = 0; i < 61; i++) last = (await app.request('/v1/market/quotes', { headers: { 'x-forwarded-for': 'same' } })).status
    expect(last).toBe(429)
    expect(limitsState.active).toBe(0)
  })

  it('also limits free routes that fan out to upstreams (ERC-8004 / audit feed)', async () => {
    const app = new Hono()
    app.use('*', limits)
    app.get('/v1/erc8004/agents/:id', c => c.text('ok'))
    let last = 0
    for (let i = 0; i < 61; i++) last = (await app.request('/v1/erc8004/agents/1')).status
    expect(last).toBe(429)
  })
})

describe('provider cache', () => {
  it('evicts so caller-controlled keys cannot grow memory without bound', async () => {
    for (let i = 0; i < MAX_CACHE_ENTRIES + 100; i++) await cached(`test:${i}`, 60_000, async () => i)
    expect(cacheSize()).toBeLessThanOrEqual(MAX_CACHE_ENTRIES)
    expect(await cached(`test:${MAX_CACHE_ENTRIES + 99}`, 60_000, async () => -1)).toBe(MAX_CACHE_ENTRIES + 99)
  })
})

describe('paid POST body validation', () => {
  it('rejects malformed JSON with 400 (so no settlement) instead of serving default data', async () => {
    const app = createApp(testEnv, { payments: false, audit: null })
    const bad = await app.request('/v1/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"prompt": "hi"' })
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as any).error.code).toBe('invalid_request')
    const arr = await app.request('/v1/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[1]' })
    expect(arr.status).toBe(400)
  })

  it('rejects absurdly long Hedera entity ids before calling the Mirror Node', async () => {
    const app = createApp(testEnv, { payments: false, audit: null })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const r = await app.request('/v1/onchain/hedera/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: `0.0.${'9'.repeat(200)}` }) })
    expect(r.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('synthetic labelling on pro routes', () => {
  it('does not present analysis of fixture candles as live data', async () => {
    const mockEnv = { ...testEnv, DATA_MODE: 'mock' as const }
    for (const op of ['intelligence.technicals', 'agent.decision', 'intelligence.report']) {
      const r = await executeOperation(mockEnv, op, { symbols: ['BTC'], marketType: 'crypto', interval: '1h', limit: 40, risk: 'balanced' })
      expect(r.meta, op).toMatchObject({ synthetic: true, dataMode: 'mock', fallback: true })
    }
    const chat = await executeOperation(mockEnv, 'ai.chat', { symbols: ['BTC'], prompt: 'hi' })
    expect(chat.meta.synthetic).toBe(true)
  })
})

describe('ERC-8004 route caching and deadlines', () => {
  const profile: AgentProfile = {
    agentId: '7', agentRegistry: 'x', owner: '0xBB168355570708002DFe73743AE2E068e298Ca98', wallet: null, uri: '',
    registration: null, reputation: { clients: 0, count: 0, average: null },
  }
  it('coalesces and caches lookups so a free route does not hammer the RPC relay', async () => {
    const reader = vi.fn(async () => { await new Promise(r => setTimeout(r, 10)); return profile })
    const app = createApp(testEnv, { payments: false, audit: null, erc8004Reader: reader })
    const results = await Promise.all([1, 2, 3].map(() => app.request('/v1/erc8004/agents/7')))
    expect(results.every(r => r.status === 200)).toBe(true)
    await app.request('/v1/erc8004/agents/7')
    expect(reader).toHaveBeenCalledTimes(1)
    expect(erc8004Config('hedera-testnet')).not.toBeNull()
  })
  it('does not cache failures', async () => {
    let n = 0
    const reader = vi.fn(async () => { if (n++ === 0) throw new Error('relay down'); return profile })
    const app = createApp(testEnv, { payments: false, audit: null, erc8004Reader: reader })
    expect((await app.request('/v1/erc8004/agents/7')).status).toBe(503)
    expect((await app.request('/v1/erc8004/agents/7')).status).toBe(200)
  })
})

describe('audit feed robustness', () => {
  it('tolerates a Mirror Node payload with non-array messages and junk rows', async () => {
    const auditEnv = { ...testEnv, HCS_AUDIT_TOPIC_ID: '0.0.9001', MERCHANT_OPERATOR_ID: '0.0.1001', MERCHANT_OPERATOR_KEY: 'x' }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ messages: { not: 'an array' } }), { status: 200 })))
    const app = createApp(auditEnv as any, { payments: false, audit: null })
    const r = await app.request('/v1/audit/recent')
    expect(r.status).toBe(200)
    expect(((await r.json()) as any).data.entries).toEqual([])
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ messages: [null, { message: 5 }, { consensus_timestamp: '../x', message: 'e30=' }] }), { status: 200 })))
    const app2 = createApp(auditEnv as any, { payments: false, audit: null })
    const r2 = await app2.request('/v1/audit/recent?limit=3')
    expect(r2.status).toBe(200)
    expect(((await r2.json()) as any).data.ignored).toBe(3)
  })
})

describe('facilitator hardening', () => {
  const requirements = { scheme: 'exact', network: 'eip155:296', asset: '0x00000000000000000000000000000000000000aa', amount: '1', payTo: '0x00000000000000000000000000000000000000bb', maxTimeoutSeconds: 60, extra: {} }
  const body = (nonce: string) => JSON.stringify({ x402Version: 2, paymentPayload: { x402Version: 2, payload: { signature: '0x1', authorization: { nonce } } }, paymentRequirements: requirements })
  const policy = { networks: ['eip155:296'], allowedAssets: [requirements.asset], allowedPayTo: [requirements.payTo], signers: [] }

  it('settles a given signed authorization once; retries and concurrent duplicates get the same receipt', async () => {
    let calls = 0
    const core: FacilitatorCore = {
      getSupported: () => ({}),
      verify: async () => ({ isValid: true }),
      settle: async () => { calls++; await new Promise(r => setTimeout(r, 10)); return { success: true, transaction: `0x${calls}`, network: 'eip155:296' } },
    }
    const app = createFacilitatorApp(core, policy, { logger: () => {} })
    const send = (b: string) => app.request('/settle', { method: 'POST', body: b })
    const [a, b] = await Promise.all([send(body('0x01')), send(body('0x01'))])
    const c = await send(body('0x01'))
    const receipts = await Promise.all([a, b, c].map(r => r.json() as Promise<any>))
    expect(receipts.map(r => r.transaction)).toEqual(['0x1', '0x1', '0x1'])
    expect(calls).toBe(1)
    await send(body('0x02'))
    expect(calls).toBe(2)
  })

  it('never returns raw RPC error text (URLs can carry API keys)', async () => {
    const secretUrl = 'https://rpc.example/v1/SECRETKEY123'
    const core: FacilitatorCore = {
      getSupported: () => ({}),
      verify: async () => { throw new Error(`HTTP request failed.\nURL: ${secretUrl}\nRequest body: {...}`) },
      settle: async () => { throw new Error(`Details: boom ${secretUrl}`) },
    }
    const logged: string[] = []
    const app = createFacilitatorApp(core, policy, { logger: l => logged.push(JSON.stringify(l)) })
    for (const path of ['/verify', '/settle']) {
      const r = await app.request(path, { method: 'POST', body: body('0x09') })
      expect(r.status).toBe(500)
      expect(await r.text()).not.toContain('SECRETKEY123')
    }
    expect(logged.join('\n')).not.toContain('SECRETKEY123')
    expect(sanitizeError(new Error(`x ${secretUrl}`))).toBe('x [url]')
  })
})

describe('agent spend policy arithmetic', () => {
  const policy: SpendPolicy = { budgetUsd: 0.3, maxPerCallUsd: 1, perMerchantUsd: 0.3, approvalAboveUsd: 1, allowedPayTo: [], requireIdentity: false }
  const req: SpendRequest = { merchant: 'm', operationId: 'op', payTo: '0.0.1001', asset: '0.0.0', amount: 1n, advertisedAmount: 1n, usd: 0.1, advertisedPayTo: '0.0.1001', identityVerified: true }

  it('uses exact integer accounting (0.1 + 0.2 fits a $0.30 budget, nothing more does)', () => {
    const ledger = new SpendLedger(policy)
    ledger.record('m', 0.1)
    ledger.record('m', 0.1)
    expect(ledger.evaluate(req).decision).toBe('allow')
    ledger.record('m', 0.1)
    expect(ledger.spentUsd).toBe(0.3)
    expect(ledger.remainingUsd).toBe(0)
    expect(ledger.evaluate({ ...req, usd: 0.000001 }).decision).toBe('deny')
  })

  it('fails closed when discovery advertised no amount for the asset', () => {
    const v = new SpendLedger(policy).evaluate({ ...req, advertisedAmount: undefined })
    expect(v.decision).toBe('deny')
    expect(v.reason).toContain('cannot verify')
  })

  it('compares EVM payees case-insensitively', () => {
    const evm = '0x153cc53c83394e6971b26d900d08fef7ae9568e8'
    expect(new SpendLedger({ ...policy, allowedPayTo: [evm.toUpperCase().replace('0X', '0x')] }).evaluate({ ...req, payTo: evm }).decision).toBe('allow')
  })

  it('planner fits the budget exactly', () => {
    const catalog = [0, 1, 2].map(i => ({ operationId: `op.x${i}`, method: 'GET' as const, path: `/${i}`, price: '$0.10', description: 'quotes' }))
    expect(planCalls('quotes', catalog, { budgetUsd: 0.3 })).toHaveLength(3)
  })
})
