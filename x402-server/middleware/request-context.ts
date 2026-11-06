import type { MiddlewareHandler } from 'hono'
export const requestContext: MiddlewareHandler = async (c, next) => {
  c.set('requestId', c.req.header('x-request-id') || crypto.randomUUID())
  c.header('X-Request-Id', c.get('requestId'))
  await next()
}
