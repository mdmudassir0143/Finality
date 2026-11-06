import { afterEach, describe, expect, it, vi } from 'vitest'
import * as route from '../../../app/api/x402/[...path]/route'

type Handler = (req: any, ctx: { params: Promise<{ path: string[] }> }) => Promise<Response>

function request(method: string, url: string, headers: Record<string, string> = {}, body?: string) {
  const req = new Request(url, { method, headers, body })
  return Object.assign(req, { nextUrl: new URL(url) })
}
const ctx = (...path: string[]) => ({ params: Promise.resolve({ path }) })

describe('Next.js -> merchant proxy (app/api/x402/[...path])', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('forwards method, query, body and x402 headers; strips hop-by-hop and site credentials', async () => {
    const seen: { url: string; init: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
      seen.push({ url: String(url), init })
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json', 'PAYMENT-RESPONSE': 'receipt', 'content-encoding': 'gzip', 'keep-alive': 'timeout=5' },
      })
    }))
    const res = await (route.POST as Handler)(
      request('POST', 'http://site.test/api/x402/v1/ai/chat?x=1', {
        'content-type': 'application/json', 'PAYMENT-SIGNATURE': 'sig', 'X-PAYMENT': 'legacy',
        cookie: 'session=secret', 'keep-alive': 'timeout=5', connection: 'keep-alive, x-hop', 'x-hop': '1',
      }, '{"prompt":"hi"}'),
      ctx('v1', 'ai', 'chat'),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('payment-response')).toBe('receipt')
    expect(res.headers.get('content-encoding')).toBeNull()
    expect(res.headers.get('keep-alive')).toBeNull()
    expect(res.headers.get('access-control-expose-headers')).toContain('PAYMENT-RESPONSE')
    const [{ url, init }] = seen
    expect(url).toMatch(/\/v1\/ai\/chat\?x=1$/)
    expect(init.method).toBe('POST')
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('{"prompt":"hi"}')
    const h = init.headers as Headers
    expect(h.get('payment-signature')).toBe('sig')
    expect(h.get('x-payment')).toBe('legacy')
    for (const name of ['cookie', 'keep-alive', 'connection', 'x-hop', 'host']) expect(h.get(name)).toBeNull()
  })

  it('preserves 402 status and PAYMENT-REQUIRED', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 402, headers: { 'PAYMENT-REQUIRED': 'req' } })))
    const res = await (route.GET as Handler)(request('GET', 'http://site.test/api/x402/v1/market/quotes?symbols=BTC'), ctx('v1', 'market', 'quotes'))
    expect(res.status).toBe(402)
    expect(res.headers.get('payment-required')).toBe('req')
  })

  it('refuses dot-segments and reports upstream timeouts as 504', async () => {
    const fetchMock = vi.fn(async () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }) })
    vi.stubGlobal('fetch', fetchMock)
    const bad = await (route.GET as Handler)(request('GET', 'http://site.test/api/x402/x'), ctx('..', 'admin'))
    expect(bad.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
    const slow = await (route.GET as Handler)(request('GET', 'http://site.test/api/x402/health'), ctx('health'))
    expect(slow.status).toBe(504)
    expect(typeof route.HEAD).toBe('function')
  })
})
