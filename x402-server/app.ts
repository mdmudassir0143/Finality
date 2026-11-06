import { Hono } from 'hono'
import type { Env } from './config/env'
import { cors } from './config/cors'
import { requestContext } from './middleware/request-context'
import { errorHandler } from './middleware/errors'
import { limits } from './middleware/limits'
import { createPaymentMiddleware, type PaymentMiddlewareOptions } from './middleware/x402'
import { registerPublicRoutes } from './routes/public'
import { registerTestRoutes } from './routes/test'
import { registerAuditRoutes } from './routes/audit'
import { registerErc8004Routes, type AgentReader } from './routes/erc8004'
import { registerMarketRoutes } from './routes/market'
import { registerIntelligenceRoutes } from './routes/intelligence'
import { registerAgentRoutes } from './routes/agents'
import { registerAiRoutes } from './routes/ai'
import { registerHederaRoutes } from './routes/onchain-hedera'

export function createApp(env: Env, options: { payments?: boolean; erc8004Reader?: AgentReader } & PaymentMiddlewareOptions = {}) {
  const app = new Hono()
  app.use('*', cors(env))
  app.use('*', requestContext)
  app.use('*', limits)
  registerPublicRoutes(app, env)
  registerTestRoutes(app, env)
  registerAuditRoutes(app, env)
  registerErc8004Routes(app, env, options.erc8004Reader)
  if (options.payments !== false) app.use(createPaymentMiddleware(env, { audit: options.audit }))
  registerMarketRoutes(app, env)
  registerIntelligenceRoutes(app, env)
  registerAgentRoutes(app, env)
  registerAiRoutes(app, env)
  registerHederaRoutes(app, env)
  app.notFound(c => c.json({ success: false, requestId: (c as any).get('requestId') || crypto.randomUUID(), error: { code: 'not_found', message: 'Endpoint not found' } }, 404))
  app.onError(errorHandler)
  return app
}
