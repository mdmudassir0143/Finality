import type { Hono } from 'hono'
import type { Env } from '../config/env'
import { fetchHederaTopicMessages, toMirrorTransactionId } from '../../lib/onchain/hedera/mirror'
import { decodeAuditMessage, type AuditMessage } from '../../lib/hedera/audit'
import { isAuditConfigured } from '../audit/sale'

type MirrorTopicMessage = { consensus_timestamp: string; sequence_number: number; message: string }

export type AuditEntry = {
  sequence: number
  consensusTimestamp: string
  /** HashScan link to the HCS message itself (tamper-evident record). */
  hcsUrl: string
  /** HashScan link to the x402 payment the message refers to, when it carries one. */
  paymentUrl: string | null
  message: AuditMessage
}

function hashscanBase(env: Env) {
  return `https://hashscan.io/${env.X402_NETWORK === 'hedera-mainnet' ? 'mainnet' : 'testnet'}`
}

function paymentUrl(base: string, tx: string | undefined): string | null {
  if (!tx) return null
  // EVM rail settlements are EVM transaction hashes, which HashScan resolves directly.
  if (/^0x[0-9a-fA-F]{64}$/.test(tx)) return `${base}/transaction/${tx}`
  try {
    return `${base}/transaction/${toMirrorTransactionId(tx)}`
  } catch {
    return null
  }
}

export const AUDIT_CACHE_TTL_MS = 5_000

/** Free, read-only view of the HCS audit topic (newest first). Reads the public Mirror Node only. */
export function registerAuditRoutes(app: Hono, env: Env) {
  // Unauthenticated route backed by the public Mirror Node: coalesce and briefly cache reads per limit.
  const cache = new Map<number, { expires: number; value: Promise<unknown> }>()
  const readTopic = (limit: number) => {
    const hit = cache.get(limit)
    if (hit && hit.expires > Date.now()) return hit.value
    const value = fetchHederaTopicMessages(env, env.HCS_AUDIT_TOPIC_ID, limit)
    cache.set(limit, { expires: Date.now() + AUDIT_CACHE_TTL_MS, value })
    value.catch(() => { if (cache.get(limit)?.value === value) cache.delete(limit) })
    return value
  }

  app.get('/v1/audit/recent', async c => {
    const base = hashscanBase(env)
    const network = env.X402_NETWORK === 'hedera-mainnet' ? 'Hedera mainnet' : 'Hedera testnet'
    if (!isAuditConfigured(env)) {
      return c.json({ success: true, data: { enabled: false, network, topicId: null, entries: [] } })
    }
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 25) || 25))
    const raw = (await readTopic(limit)) as { messages?: unknown } | null
    // Mirror Node responses are untrusted input: tolerate a missing/non-array `messages` and malformed rows.
    const messages = (Array.isArray(raw?.messages) ? raw.messages : []) as Partial<MirrorTopicMessage>[]
    const entries: AuditEntry[] = []
    for (const m of messages) {
      if (!m || typeof m.message !== 'string' || typeof m.consensus_timestamp !== 'string') continue
      if (!/^\d+\.\d+$/.test(m.consensus_timestamp)) continue
      const message = decodeAuditMessage(m.message)
      if (!message) continue
      entries.push({
        sequence: Number(m.sequence_number),
        consensusTimestamp: m.consensus_timestamp,
        hcsUrl: `${base}/transaction/${m.consensus_timestamp}`,
        paymentUrl: paymentUrl(base, message.tx),
        message,
      })
    }
    return c.json({
      success: true,
      data: {
        enabled: true,
        network,
        topicId: env.HCS_AUDIT_TOPIC_ID,
        topicUrl: `${base}/topic/${env.HCS_AUDIT_TOPIC_ID}`,
        schema: 'finality.audit.v1',
        entries,
        ignored: messages.length - entries.length,
      },
    })
  })
}
