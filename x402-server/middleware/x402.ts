import { paymentMiddleware } from '@x402/hono'
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server'
import { ExactHederaScheme } from '@x402/hedera/exact/server'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import type { Env } from '../config/env'
import { caip2ForNetwork, evmRail, hederaDefaultAssets, isPayToConfigured, paymentAccepts, resolvePayTo } from '../config/payment'
import { endpoints } from '../registry/endpoints'
import { PLATFORM, DISCOVERY_TAGS } from '../discovery/platform'
import type { AuditPublisher } from '../../lib/hedera/hcs'
import { auditPublisherFromEnv, buildSaleMessage } from '../audit/sale'

function categoryFor(operationId: string) {
  if (operationId.startsWith('market.')) return 'Market data'
  if (operationId.startsWith('intelligence.')) return 'Intelligence'
  if (operationId.startsWith('agent.')) return 'Agent tools'
  if (operationId.startsWith('ai.')) return 'AI analyst'
  if (operationId.startsWith('onchain.')) return 'Hedera'
  return 'Finality'
}

export type PaymentMiddlewareOptions = {
  /** Override the HCS audit publisher (tests). `null` disables auditing; omitted means build from env. */
  audit?: AuditPublisher | null
}

export function createPaymentMiddleware(env: Env, options: PaymentMiddlewareOptions = {}) {
  const payTo = resolvePayTo(env)
  if (!isPayToConfigured(payTo)) {
    console.warn(JSON.stringify({
      level: 'warn',
      message: 'X402_PAYTO_ADDRESS is unset or placeholder. Set a real Hedera account id before accepting live payments.',
    }))
  }
  const network = caip2ForNetwork(env.X402_NETWORK)
  // Native rail: HBAR / HTS USDC settled by Blocky402 (unchanged). EVM rail (optional): fUSD on Hedera EVM settled
  // by Finality's own facilitator. The resource server routes each payment to the facilitator that supports it.
  const rail = evmRail(env)
  const facilitators = [
    new HTTPFacilitatorClient({ url: env.X402_FACILITATOR_URL }),
    ...(rail ? [new HTTPFacilitatorClient({ url: rail.facilitator })] : []),
  ]
  const server = new x402ResourceServer(facilitators).register(
    'hedera:*',
    new ExactHederaScheme({ defaultAssets: hederaDefaultAssets(env) }),
  )
  if (rail) server.register(rail.network, new ExactEvmScheme())

  // HCS audit trail: after Blocky402 settles, enqueue a `sale` message (hash of the delivered bytes).
  // Publishing is fire-and-forget and never delays, alters or fails the paid response.
  const audit = options.audit === undefined ? auditPublisherFromEnv(env) : options.audit
  if (audit) {
    server.onAfterSettle(async context => {
      try {
        const message = buildSaleMessage(context)
        if (message) audit.publish(message)
      } catch (error) {
        console.warn(JSON.stringify({ level: 'warn', message: 'hcs.audit.build_failed', error: String(error) }))
      }
    })
  }

  const publicBase = (env.X402_PUBLIC_URL || PLATFORM.apiBase).replace(/\/$/, '')

  const routes = Object.fromEntries(endpoints.map(endpoint => {
    const category = categoryFor(endpoint.operationId)
    return [`${endpoint.method} ${endpoint.path}`, {
      ...(publicBase ? { resource: `${publicBase}${endpoint.path}` } : {}),
      accepts: paymentAccepts(env, endpoint.price, payTo, network),
      description: endpoint.description,
      mimeType: 'application/json',
      serviceName: 'Finality Market Intelligence',
      tags: [...DISCOVERY_TAGS, category.toLowerCase()],
    }]
  }))

  if (!publicBase) {
    console.warn(JSON.stringify({
      level: 'warn',
      message: 'X402_PUBLIC_URL is unset. 402 responses will use the request Host (often localhost).',
    }))
  }

  return paymentMiddleware(routes as any, server)
}
