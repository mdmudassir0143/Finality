import type { MiddlewareHandler } from 'hono'
import { endpoints } from '../registry/endpoints'

export const WINDOW_MS = 60_000
export const MAX_PER_WINDOW = 60
export const MAX_CONCURRENT = 50
/** Hard cap on tracked (client, path) windows so spoofed client ids cannot grow memory without bound. */
export const MAX_WINDOWS = 10_000

const windows = new Map<string, { start: number; count: number }>()
let active = 0
let lastSweep = 0
const paths = new Set(endpoints.map(v => v.path))
/** Free routes that still fan out to an upstream (Mirror Node / JSON-RPC relay) get the same per-client limit. */
const FREE_UPSTREAM = [/^\/v1\/audit\/recent$/, /^\/v1\/erc8004\//]
const limited = (path: string) => paths.has(path) || FREE_UPSTREAM.some(re => re.test(path))

/** Drop expired windows; if still over the cap (flood of distinct keys), evict oldest-first (Map keeps insertion order). */
function sweep(now: number) {
  if (now - lastSweep < 5_000 && windows.size < MAX_WINDOWS) return
  lastSweep = now
  for (const [key, entry] of windows) if (now - entry.start >= WINDOW_MS) windows.delete(key)
  for (const key of windows.keys()) {
    if (windows.size < MAX_WINDOWS) break
    windows.delete(key)
  }
}

/** Test/introspection hooks. */
export const limitsState = {
  get windows() { return windows.size },
  get active() { return active },
  reset() { windows.clear(); active = 0; lastSweep = 0 },
}

export const limits: MiddlewareHandler = async (c, next) => {
  if (!limited(c.req.path)) return next()
  const length = Number(c.req.header('content-length') ?? 0)
  if (length > 32_768) return c.json({ success:false, requestId:(c as any).get('requestId'), error:{ code:'payload_too_large', message:'Request body exceeds 32768 bytes' } }, 413)
  const payer = c.req.header('x-payer-address') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const key = `${payer.slice(0, 128)}:${c.req.path}`, now = Date.now()
  sweep(now)
  const entry = windows.get(key)
  const current = !entry || now - entry.start >= WINDOW_MS ? { start: now, count: 0 } : entry
  current.count++
  if (current !== entry) windows.delete(key) // re-insert so insertion order tracks window start for eviction
  windows.set(key, current)
  if (current.count > MAX_PER_WINDOW) return c.json({ success:false, requestId:(c as any).get('requestId'), error:{ code:'rate_limited', message:'Endpoint rate limit exceeded', retryable:true } }, 429, { 'Retry-After': String(Math.ceil((current.start + WINDOW_MS - now) / 1000)) })
  if (active >= MAX_CONCURRENT) return c.json({ success:false, requestId:(c as any).get('requestId'), error:{ code:'concurrency_limited', message:'Server concurrency limit reached', retryable:true } }, 503)
  active++
  try { await next() } finally { active-- }
}
