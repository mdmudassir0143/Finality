import { createHash } from 'node:crypto'
import type { SettleResultContext } from '@x402/core/server'
import { AuditPublisher, createOperatorClient, sdkSubmitter } from '../../lib/hedera/hcs'
import { AUDIT_SCHEMA_ID, type AuditSale } from '../../lib/hedera/audit'
import type { Env } from '../config/env'
import { endpoints } from '../registry/endpoints'

const ENTITY = /^\d+\.\d+\.\d+$/

export function isAuditConfigured(env: Env): boolean {
  return ENTITY.test(env.HCS_AUDIT_TOPIC_ID) && ENTITY.test(env.MERCHANT_OPERATOR_ID) && Boolean(env.MERCHANT_OPERATOR_KEY)
}

/** Builds the merchant's audit publisher from env, or null when audit logging is not configured. */
export function auditPublisherFromEnv(env: Env): AuditPublisher | null {
  if (!isAuditConfigured(env)) return null
  const client = createOperatorClient({
    network: env.X402_NETWORK,
    operatorId: env.MERCHANT_OPERATOR_ID,
    operatorKey: env.MERCHANT_OPERATOR_KEY,
  })
  return new AuditPublisher(env.HCS_AUDIT_TOPIC_ID, sdkSubmitter(client))
}

type TransportContext = {
  request?: { path?: string; method?: string }
  responseBody?: Uint8Array
}

/** Turn a successful settlement into a `finality.audit.v1` sale message. Returns null if it cannot be attributed. */
export function buildSaleMessage(context: SettleResultContext, now: Date = new Date()): AuditSale | null {
  const { result, requirements } = context
  if (!result.success || !result.transaction) return null
  const transport = (context.transportContext ?? {}) as TransportContext
  const method = (transport.request?.method ?? '').toUpperCase()
  const path = transport.request?.path ?? ''
  const endpoint = endpoints.find((e) => e.method === method && e.path === path)
  const body = transport.responseBody ?? new Uint8Array()
  return {
    v: AUDIT_SCHEMA_ID,
    type: 'sale',
    op: endpoint?.operationId ?? 'unknown',
    method: method || 'GET',
    path: path.slice(0, 160),
    payer: String(result.payer ?? ''),
    payTo: requirements.payTo,
    asset: requirements.asset,
    amount: String(requirements.amount),
    network: String(result.network ?? requirements.network),
    tx: result.transaction,
    sha256: createHash('sha256').update(body).digest('hex'),
    ts: now.toISOString(),
  }
}
