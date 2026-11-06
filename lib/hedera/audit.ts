import { z } from 'zod'

/**
 * `finality.audit.v1` — the message format written to the Finality HCS audit topic.
 *
 * - `sale`: written by the merchant after Blocky402 settles a payment. `sha256` is the hash of the
 *   exact response bytes delivered for that payment (data-sharing provenance). On the EVM rail (fUSD on
 *   Hedera EVM, Finality's own facilitator) `payTo`/`asset` are 0x addresses and `tx` is the EVM hash.
 * - `spend`: written by a buying agent after it pays, including its policy decision and budget.
 *
 * Messages are compact JSON kept well under the 1024-byte single-chunk HCS limit.
 */
export const AUDIT_SCHEMA_ID = 'finality.audit.v1'

const hederaEntity = z.string().regex(/^\d+\.\d+\.\d+$/)
/** Payee/asset on either rail: a Hedera entity (0.0.x) or, for the fUSD rail on Hedera EVM, a 0x address. */
const ledgerRef = z.union([hederaEntity, z.string().regex(/^0x[0-9a-fA-F]{40}$/)])

export const auditSaleSchema = z.object({
  v: z.literal(AUDIT_SCHEMA_ID),
  type: z.literal('sale'),
  op: z.string().max(80),
  method: z.string().max(8),
  path: z.string().max(160),
  payer: z.string().max(64),
  payTo: ledgerRef,
  asset: ledgerRef,
  amount: z.string().regex(/^\d+$/),
  network: z.string().max(32),
  tx: z.string().max(80),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  ts: z.string().max(40),
})

export const auditSpendSchema = z.object({
  v: z.literal(AUDIT_SCHEMA_ID),
  type: z.literal('spend'),
  agent: z.string().max(120),
  op: z.string().max(80),
  merchant: z.string().max(160),
  payTo: ledgerRef,
  asset: ledgerRef,
  amount: z.string().regex(/^\d+$/),
  usd: z.number().nonnegative(),
  network: z.string().max(32),
  tx: z.string().max(80).optional(),
  decision: z.enum(['paid', 'skipped', 'denied', 'failed']),
  reason: z.string().max(160).optional(),
  budgetLeftUsd: z.number(),
  ts: z.string().max(40),
})

export const auditMessageSchema = z.discriminatedUnion('type', [auditSaleSchema, auditSpendSchema])

export type AuditSale = z.infer<typeof auditSaleSchema>
export type AuditSpend = z.infer<typeof auditSpendSchema>
export type AuditMessage = z.infer<typeof auditMessageSchema>

export const MAX_AUDIT_MESSAGE_BYTES = 1024

export function encodeAuditMessage(message: AuditMessage): string {
  const parsed = auditMessageSchema.parse(message)
  const json = JSON.stringify(parsed)
  if (Buffer.byteLength(json, 'utf8') > MAX_AUDIT_MESSAGE_BYTES) {
    throw new Error(`Audit message exceeds ${MAX_AUDIT_MESSAGE_BYTES} bytes`)
  }
  return json
}

/** Decode a Mirror Node topic message (`message` is base64). Returns null for non-audit messages. */
export function decodeAuditMessage(base64: string): AuditMessage | null {
  try {
    const parsed = auditMessageSchema.safeParse(JSON.parse(Buffer.from(base64, 'base64').toString('utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
