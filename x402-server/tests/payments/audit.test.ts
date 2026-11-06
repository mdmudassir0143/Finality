import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { x402Client } from '@x402/core/client'
import { encodePaymentSignatureHeader, decodePaymentRequiredHeader } from '@x402/core/http'
import { ExactHederaScheme } from '@x402/hedera/exact/client'
import { HEDERA_TESTNET_CAIP2, HEDERA_TESTNET_USDC } from '@x402/hedera'
import { createApp } from '../../app'
import { testEnv } from '../helpers'
import { AuditPublisher, type SubmitFn } from '../../../lib/hedera/hcs'
import { decodeAuditMessage, encodeAuditMessage } from '../../../lib/hedera/audit'
import { isAuditConfigured } from '../../audit/sale'

const SETTLED_TX = '0.0.5005@1700000000.000000001'

function stubFacilitator(settle: () => Response) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input)
    calls.push(url)
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url.endsWith('/supported')) {
      return json({ kinds: [{ x402Version: 2, scheme: 'exact', network: HEDERA_TESTNET_CAIP2, extra: { feePayer: '0.0.7162784' } }], extensions: [], signers: {} })
    }
    if (url.endsWith('/verify')) return json({ isValid: true, payer: '0.0.5005' })
    if (url.endsWith('/settle')) return settle()
    throw new Error(`Unexpected request ${url}`)
  }))
  return calls
}

async function paidRequest(app: ReturnType<typeof createApp>, path: string) {
  const unpaid = await app.request(path)
  expect(unpaid.status).toBe(402)
  const required = decodePaymentRequiredHeader(unpaid.headers.get('payment-required')!)
  const signer = { accountId: '0.0.5005', createPartiallySignedTransferTransaction: async () => Buffer.from('tx').toString('base64') }
  const client = x402Client.fromConfig({
    schemes: [{ network: HEDERA_TESTNET_CAIP2, client: new ExactHederaScheme(signer as any) }],
    paymentRequirementsSelector: (_v, reqs) => reqs.find(r => r.asset === HEDERA_TESTNET_USDC)!,
  })
  const payload = await client.createPaymentPayload(required)
  return app.request(path, { headers: { 'PAYMENT-SIGNATURE': encodePaymentSignatureHeader(payload) } })
}

describe('HCS audit trail (merchant sale messages)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is off unless topic, operator id and operator key are all set', () => {
    expect(isAuditConfigured(testEnv)).toBe(false)
    expect(isAuditConfigured({ ...testEnv, HCS_AUDIT_TOPIC_ID: '0.0.9001', MERCHANT_OPERATOR_ID: '0.0.1001', MERCHANT_OPERATOR_KEY: 'k' })).toBe(true)
    expect(isAuditConfigured({ ...testEnv, HCS_AUDIT_TOPIC_ID: '0.0.9001', MERCHANT_OPERATOR_ID: '0.0.1001' })).toBe(false)
  })

  it('publishes one sale message per settled payment, hashing the delivered bytes', async () => {
    stubFacilitator(() => new Response(JSON.stringify({ success: true, transaction: SETTLED_TX, network: HEDERA_TESTNET_CAIP2, payer: '0.0.5005' }), { status: 200 }))
    const submitted: string[] = []
    const submit: SubmitFn = async (_topic, message) => { submitted.push(message); return { sequenceNumber: String(submitted.length), transactionId: 'audit-tx' } }
    const audit = new AuditPublisher('0.0.9001', submit, { logger: () => {} })
    const app = createApp(testEnv, { audit })

    const response = await paidRequest(app, '/v1/market/quotes?symbols=BTC')
    expect(response.status).toBe(200)
    const bodyBytes = Buffer.from(await response.arrayBuffer())
    await audit.flush()

    expect(submitted).toHaveLength(1)
    const message = decodeAuditMessage(Buffer.from(submitted[0]).toString('base64'))
    expect(message).toMatchObject({
      v: 'finality.audit.v1', type: 'sale', op: 'market.quotes', method: 'GET', path: '/v1/market/quotes',
      payer: '0.0.5005', payTo: '0.0.1001', asset: HEDERA_TESTNET_USDC, network: HEDERA_TESTNET_CAIP2, tx: SETTLED_TX,
    })
    expect(message && 'sha256' in message ? message.sha256 : '').toBe(createHash('sha256').update(bodyBytes).digest('hex'))
    expect(Buffer.byteLength(submitted[0])).toBeLessThan(1024)
  })

  it('never fails the paid response when HCS submission fails', async () => {
    stubFacilitator(() => new Response(JSON.stringify({ success: true, transaction: SETTLED_TX, network: HEDERA_TESTNET_CAIP2, payer: '0.0.5005' }), { status: 200 }))
    const audit = new AuditPublisher('0.0.9001', async () => { throw new Error('INVALID_SIGNATURE') }, { logger: () => {} })
    const app = createApp(testEnv, { audit })
    const response = await paidRequest(app, '/v1/market/quotes?symbols=BTC')
    expect(response.status).toBe(200)
    await audit.flush()
    expect(audit.failures).toBe(1)
  })

  it('writes nothing when settlement fails', async () => {
    stubFacilitator(() => new Response(JSON.stringify({ success: false, errorReason: 'insufficient_funds', transaction: '', network: HEDERA_TESTNET_CAIP2 }), { status: 200 }))
    const submitted: string[] = []
    const audit = new AuditPublisher('0.0.9001', async (_t, m) => { submitted.push(m); return { sequenceNumber: '1', transactionId: 'x' } }, { logger: () => {} })
    const app = createApp(testEnv, { audit })
    const response = await paidRequest(app, '/v1/market/quotes?symbols=BTC')
    expect(response.status).not.toBe(200)
    await audit.flush()
    expect(submitted).toHaveLength(0)
  })

  it('rejects malformed audit messages before they reach HCS', () => {
    expect(() => encodeAuditMessage({ v: 'finality.audit.v1', type: 'sale' } as any)).toThrow()
  })
})
