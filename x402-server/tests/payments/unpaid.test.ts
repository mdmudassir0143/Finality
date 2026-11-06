import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../app'
import { testEnv } from '../helpers'
import { HEDERA_TESTNET_CAIP2, HEDERA_TESTNET_USDC, HBAR_ASSET_ID } from '../../config/payment'

function decodePaymentRequired(header: string) {
  return JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as {
    accepts?: Array<{ extra?: { asset?: string; symbol?: string }; network?: string; payTo?: string; asset?: string }>
  }
}

describe('x402 payment enforcement', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns 402 before running a paid handler', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/supported')) {
        return new Response(
          JSON.stringify({
            kinds: [{
              x402Version: 2,
              scheme: 'exact',
              network: HEDERA_TESTNET_CAIP2,
              extra: { feePayer: '0.0.7162784' },
            }],
            extensions: [],
            signers: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(`Unexpected request ${url}`)
    }))
    const app = createApp(testEnv)
    const r = await app.request('/v1/market/quotes?symbols=BTC')
    expect(r.status).toBe(402)
    const header = r.headers.get('payment-required') ?? r.headers.get('PAYMENT-REQUIRED')
    expect(header).toBeTruthy()
    const decoded = Buffer.from(header!, 'base64').toString('utf8')
    expect(decoded).toContain('hedera')
    expect(decoded.includes(HEDERA_TESTNET_USDC) || decoded.includes(HBAR_ASSET_ID)).toBe(true)
  })

  it('advertises both USDC and HBAR accepts', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/supported')) {
        return new Response(
          JSON.stringify({
            kinds: [{
              x402Version: 2,
              scheme: 'exact',
              network: HEDERA_TESTNET_CAIP2,
              extra: { feePayer: '0.0.7162784' },
            }],
            extensions: [],
            signers: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(`Unexpected request ${url}`)
    }))
    const app = createApp(testEnv)
    const r = await app.request('/v1/market/quotes?symbols=BTC')
    expect(r.status).toBe(402)
    const header = r.headers.get('payment-required') ?? r.headers.get('PAYMENT-REQUIRED')
    expect(header).toBeTruthy()
    const body = decodePaymentRequired(header!)
    const assets = (body.accepts ?? []).map(a => a.asset ?? a.extra?.asset)
    expect(assets).toEqual(expect.arrayContaining([HEDERA_TESTNET_USDC, HBAR_ASSET_ID]))
  })

  it('advertises payTo from X402_PAYTO_ADDRESS, never the placeholder', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/supported')) {
        return new Response(
          JSON.stringify({
            kinds: [{ x402Version: 2, scheme: 'exact', network: HEDERA_TESTNET_CAIP2, extra: { feePayer: '0.0.7162784' } }],
            extensions: [],
            signers: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(`Unexpected request ${url}`)
    }))
    const app = createApp({ ...testEnv, X402_PAYTO_ADDRESS: '0.0.12345' })
    const r = await app.request('/v1/market/quotes?symbols=BTC')
    expect(r.status).toBe(402)
    const header = r.headers.get('payment-required') ?? r.headers.get('PAYMENT-REQUIRED')
    const body = decodePaymentRequired(header!)
    expect(body.accepts?.length).toBe(2)
    for (const accept of body.accepts ?? []) expect(accept.payTo).toBe('0.0.12345')

    const info = await (await app.request('/', { headers: { accept: 'application/json' } })).json() as { payTo: string }
    expect(info.payTo).toBe('0.0.12345')
  })

  it('rejects a malformed payment signature', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/supported')) {
        return new Response(
          JSON.stringify({
            kinds: [{
              x402Version: 2,
              scheme: 'exact',
              network: HEDERA_TESTNET_CAIP2,
              extra: { feePayer: '0.0.7162784' },
            }],
            extensions: [],
            signers: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error('The facilitator must not be called with an undecodable signature')
    }))
    const app = createApp(testEnv)
    const r = await app.request('/v1/market/quotes?symbols=BTC', {
      headers: { 'Payment-Signature': 'not-a-valid-payload' },
    })
    expect([400, 402, 500]).toContain(r.status)
  })
})
