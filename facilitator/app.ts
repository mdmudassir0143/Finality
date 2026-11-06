import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types'

/** The subset of x402Facilitator this HTTP layer needs (kept narrow so tests can stub it). */
export type FacilitatorCore = {
  getSupported(): unknown
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<{ isValid: boolean; invalidReason?: string; payer?: string }>
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<{ success: boolean; errorReason?: string; transaction: string; network: string; payer?: string }>
}

export type FacilitatorPolicy = {
  /** CAIP-2 networks this facilitator settles (e.g. eip155:296). */
  networks: string[]
  /** Token contracts it will move (lowercase compare). Anything else is refused before any RPC call. */
  allowedAssets: string[]
  /** Recipients it will pay gas for (lowercase compare). Empty = any recipient. */
  allowedPayTo: string[]
  /** Facilitator wallet address(es), reported by /health. */
  signers: string[]
}

const MAX_BODY_BYTES = 32_768
/** How long a successful settlement is remembered so a retried /settle returns the same receipt. */
export const SETTLE_REPLAY_TTL_MS = 15 * 60_000
const MAX_SETTLE_RECORDS = 2_000

/**
 * Error text from viem / RPC can embed the RPC URL (which may carry an API key) and full request bodies.
 * Keep only the first line, strip URLs and long hex blobs; never return or log more than that.
 */
export function sanitizeError(error: unknown): string {
  const e = error as { shortMessage?: string; message?: string } | undefined
  const first = String(e?.shortMessage ?? e?.message ?? error ?? '').split('\n')[0]
  return first
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"')]+/gi, '[url]')
    .replace(/0x[0-9a-fA-F]{66,}/g, '[hex]')
    .slice(0, 200)
}

type SettleResult = Awaited<ReturnType<FacilitatorCore['settle']>>

type Body = { x402Version?: number; paymentPayload?: PaymentPayload; paymentRequirements?: PaymentRequirements }

/**
 * Finality's own x402 facilitator for Hedera EVM (EIP-3009 `exact`). Same HTTP contract as hosted facilitators:
 * GET /supported, POST /verify, POST /settle ({ x402Version, paymentPayload, paymentRequirements }), plus /health.
 *
 * The policy is checked first, so the gas wallet only ever settles the allow-listed asset to allow-listed payees.
 */
export function createFacilitatorApp(
  core: FacilitatorCore,
  policy: FacilitatorPolicy,
  options: { logger?: (line: Record<string, unknown>) => void } = {},
) {
  const app = new Hono()
  const log = options.logger ?? ((line: Record<string, unknown>) => console.warn(JSON.stringify(line)))
  // Settle idempotency: the same signed authorization (EIP-3009 nonce) is only ever submitted once. Concurrent
  // duplicates share the in-flight submission, and a retry after success gets the original receipt back instead
  // of a revert (or a second gas spend when two submissions race past simulation).
  const settled = new Map<string, { expires: number; result: SettleResult }>()
  const inflight = new Map<string, Promise<SettleResult>>()
  const settleKey = (body: Body) =>
    createHash('sha256')
      .update(JSON.stringify([body.paymentRequirements?.network, String(body.paymentRequirements?.asset).toLowerCase(), body.paymentPayload?.payload]))
      .digest('hex')
  const remember = (key: string, result: SettleResult) => {
    const now = Date.now()
    for (const [k, v] of settled) if (v.expires <= now || settled.size >= MAX_SETTLE_RECORDS) settled.delete(k); else break
    settled.set(key, { expires: now + SETTLE_REPLAY_TTL_MS, result })
  }
  const assets = new Set(policy.allowedAssets.map((a) => a.toLowerCase()))
  const payTo = new Set(policy.allowedPayTo.map((a) => a.toLowerCase()))

  const readBody = async (raw: Request): Promise<Body | { error: string; status: 400 | 413 }> => {
    const length = Number(raw.headers.get('content-length') ?? 0)
    if (length > MAX_BODY_BYTES) return { error: 'payload_too_large', status: 413 }
    const text = await raw.text()
    if (text.length > MAX_BODY_BYTES) return { error: 'payload_too_large', status: 413 }
    try {
      return JSON.parse(text) as Body
    } catch {
      return { error: 'invalid_json', status: 400 }
    }
  }

  /** Policy check shared by verify and settle; returns a reason string when the request is refused. */
  const refuse = (body: Body): string | null => {
    const req = body.paymentRequirements
    if (!body.paymentPayload || !req) return 'invalid_request'
    if (req.scheme !== 'exact') return 'unsupported_scheme'
    if (!policy.networks.includes(req.network)) return 'invalid_network'
    if (!assets.has(String(req.asset).toLowerCase())) return 'unsupported_asset'
    if (payTo.size && !payTo.has(String(req.payTo).toLowerCase())) return 'payee_not_allowed'
    return null
  }

  app.get('/health', (c) =>
    c.json({ status: 'ok', service: 'Finality EVM facilitator', networks: policy.networks, assets: policy.allowedAssets, signers: policy.signers }),
  )

  app.get('/supported', (c) => c.json(core.getSupported() as object))

  app.post('/verify', async (c) => {
    const body = await readBody(c.req.raw)
    if ('error' in body) return c.json({ isValid: false, invalidReason: body.error }, body.status)
    const reason = refuse(body)
    if (reason) return c.json({ isValid: false, invalidReason: reason }, 400)
    try {
      return c.json(await core.verify(body.paymentPayload!, body.paymentRequirements!))
    } catch (error) {
      log({ level: 'warn', message: 'facilitator.verify_error', error: sanitizeError(error) })
      return c.json({ isValid: false, invalidReason: 'unexpected_verify_error' }, 500)
    }
  })

  app.post('/settle', async (c) => {
    const body = await readBody(c.req.raw)
    const network = (!('error' in body) && body.paymentRequirements?.network) || ''
    if ('error' in body) return c.json({ success: false, errorReason: body.error, transaction: '', network }, body.status)
    const reason = refuse(body)
    if (reason) return c.json({ success: false, errorReason: reason, transaction: '', network }, 400)
    const key = settleKey(body)
    const done = settled.get(key)
    if (done && done.expires > Date.now()) return c.json(done.result)
    let pending = inflight.get(key)
    if (!pending) {
      pending = core.settle(body.paymentPayload!, body.paymentRequirements!).then((result) => {
        if (result.success && result.transaction) remember(key, result)
        return result
      })
      const p = pending
      inflight.set(key, p)
      p.finally(() => { if (inflight.get(key) === p) inflight.delete(key) }).catch(() => {})
    }
    try {
      return c.json(await pending)
    } catch (error) {
      log({ level: 'warn', message: 'facilitator.settle_error', network, error: sanitizeError(error) })
      return c.json({ success: false, errorReason: 'unexpected_settle_error', transaction: '', network }, 500)
    }
  })

  app.notFound((c) => c.json({ error: 'not_found' }, 404))
  return app
}
