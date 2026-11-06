import type { MiddlewareHandler } from 'hono'
import type { Env } from './env'

export function cors(env: Env): MiddlewareHandler {
  const allowed = new Set(env.X402_ALLOWED_ORIGINS.split(',').map(v => v.trim()))
  return async (c, next) => {
    const origin = c.req.header('origin')
    if (origin && (allowed.has('*') || allowed.has(origin))) c.header('Access-Control-Allow-Origin', origin)
    c.header('Vary', 'Origin')
    c.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    c.header('Access-Control-Allow-Headers', 'Content-Type,Payment-Signature,X-PAYMENT')
    c.header('Access-Control-Expose-Headers', 'Payment-Required,Payment-Response,PAYMENT-REQUIRED,PAYMENT-RESPONSE')
    if (c.req.method === 'OPTIONS') return c.body(null, 204)
    await next()
  }
}
