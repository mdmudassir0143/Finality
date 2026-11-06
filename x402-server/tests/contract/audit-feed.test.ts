import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../app'
import { testEnv } from '../helpers'

const auditEnv = { ...testEnv, HCS_AUDIT_TOPIC_ID: '0.0.9001', MERCHANT_OPERATOR_ID: '0.0.1001', MERCHANT_OPERATOR_KEY: 'unused-in-test' }

const sale = {
  v: 'finality.audit.v1', type: 'sale', op: 'market.quotes', method: 'GET', path: '/v1/market/quotes',
  payer: '0.0.5005', payTo: '0.0.1001', asset: '0.0.429274', amount: '150000', network: 'hedera:testnet',
  tx: '0.0.5005@1700000000.000000001', sha256: 'a'.repeat(64), ts: '2026-11-06T00:00:00.000Z',
}
const b64 = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64')

describe('GET /v1/audit/recent', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reports disabled without touching the Mirror Node when audit is not configured', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const app = createApp(testEnv, { payments: false })
    const body = await (await app.request('/v1/audit/recent')).json() as any
    expect(body.data).toMatchObject({ enabled: false, topicId: null, entries: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('decodes finality.audit.v1 messages, ignores others and links HashScan', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) => new Response(JSON.stringify({
      messages: [
        { consensus_timestamp: '1700000005.000000002', sequence_number: 2, message: b64(sale) },
        { consensus_timestamp: '1700000004.000000001', sequence_number: 1, message: b64('hello world') },
      ],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const app = createApp(auditEnv as any, { payments: false })
    const response = await app.request('/v1/audit/recent?limit=10')
    expect(response.status).toBe(200)
    const body = await response.json() as any
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/topics/0.0.9001/messages?limit=10')
    expect(body.data).toMatchObject({ enabled: true, topicId: '0.0.9001', topicUrl: 'https://hashscan.io/testnet/topic/0.0.9001', ignored: 1 })
    expect(body.data.entries).toHaveLength(1)
    expect(body.data.entries[0]).toMatchObject({
      sequence: 2,
      hcsUrl: 'https://hashscan.io/testnet/transaction/1700000005.000000002',
      paymentUrl: 'https://hashscan.io/testnet/transaction/0.0.5005-1700000000-000000001',
      message: { type: 'sale', op: 'market.quotes' },
    })
  })

  it('advertises the audit topic in discovery when configured', async () => {
    const app = createApp(auditEnv as any, { payments: false })
    const wellKnown = await (await app.request('/.well-known/x402')).json() as any
    expect(wellKnown.audit).toMatchObject({ protocol: 'hcs', topicId: '0.0.9001' })
    expect(await (await app.request('/llms.txt')).text()).toContain('HCS topic 0.0.9001')
    const health = await (await app.request('/health')).json() as any
    expect(health.components.hcsAudit).toEqual({ status: 'configured', topicId: '0.0.9001' })
  })
})
