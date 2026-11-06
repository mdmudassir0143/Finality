import { createHash } from 'node:crypto'
import { x402Client } from '@x402/core/client'
import { decodePaymentRequiredHeader } from '@x402/core/http'
import { decodePaymentResponseHeader, wrapFetchWithPayment } from '@x402/fetch'
import { ExactHederaScheme } from '@x402/hedera/exact/client'
import { HBAR_ASSET_ID, type ClientHederaSigner } from '@x402/hedera'
import type { Hex } from 'viem'
import type { AgentProfile } from '../../lib/evm/erc8004'
import { AUDIT_SCHEMA_ID, type AuditSpend } from '../../lib/hedera/audit'
import type { AuditPublisher } from '../../lib/hedera/hcs'
import { hederaSpendControls } from '../../lib/x402/spend'
import { advertisedKey, discoverMerchant, isIdentityVerified, type Discovery, type MerchantIdentity } from './discovery'
import { usdFromPrice, type CatalogEntry } from './planner'
import { SpendLedger, type SpendPolicy } from './policy'

export type Asset = 'USDC' | 'HBAR'

export type AgentDeps = {
  fetch: typeof fetch
  signer: ClientHederaSigner
  /** CAIP-2 network the agent pays on, e.g. hedera:testnet. */
  caip2: string
  /** Identity of this agent used in audit records, e.g. eip155:296:0x8004…#145. */
  agentLabel: string
  readIdentity?: (identity: MerchantIdentity) => Promise<AgentProfile | null>
  audit?: AuditPublisher | null
  /** Sends ERC-8004 feedback for the merchant; returns the EVM transaction hash. */
  feedback?: (input: { agentId: bigint; score: number; tag1: string; tag2: string; endpoint: string; feedbackHash: Hex }) => Promise<string>
  approve: (question: string) => Promise<boolean>
  log: (line: string) => void
}

export type CallResult = {
  operationId: string
  usd: number
  asset: Asset
  amount: string | null
  decision: AuditSpend['decision']
  reason: string
  paymentTx: string | null
  sha256: string | null
  feedbackTx: string | null
  synthetic: boolean
  summary: string | null
}

/** A paid call's outcome plus the parsed response data (only when paid). */
export type PaidCallOutcome = CallResult & { data: unknown }

const isHbar = (asset: string) => asset === HBAR_ASSET_ID

export function requestFor(merchant: string, entry: CatalogEntry, input: Record<string, unknown>): { url: string; init: RequestInit } {
  if (entry.method === 'GET') {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(input)) qs.set(k, Array.isArray(v) ? v.join(',') : String(v))
    const query = qs.toString()
    return { url: `${merchant}${entry.path}${query ? `?${query}` : ''}`, init: { method: 'GET' } }
  }
  return {
    url: `${merchant}${entry.path}`,
    init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) },
  }
}

export function summarize(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const text = JSON.stringify(data)
  return text.length > 160 ? `${text.slice(0, 157)}…` : text
}

/**
 * One buyer session with one merchant: discovery and identity are resolved once; every `call` then runs
 * 402 → policy → (approval) → pay → verify receipt → HCS spend record → ERC-8004 feedback, against a single
 * SpendLedger, so the budget holds across calls no matter who chooses them (a fixed plan or an LLM).
 * Denials and skips are audited too, so the HCS log shows every decision, not just spends.
 */
export class MerchantSession {
  readonly ledger: SpendLedger

  private constructor(
    readonly discovery: Discovery,
    readonly profile: AgentProfile | null,
    readonly identityVerified: boolean,
    readonly policy: SpendPolicy,
    readonly asset: Asset,
    private readonly deps: AgentDeps,
  ) {
    this.ledger = new SpendLedger(policy)
  }

  static async open(opts: { merchant: string; policy: SpendPolicy; asset: Asset }, deps: AgentDeps): Promise<MerchantSession> {
    const discovery = await discoverMerchant(opts.merchant, deps.fetch)
    deps.log(`Discovered ${discovery.name} at ${discovery.merchant} on ${discovery.network}: ${discovery.catalog.length} paid operations`)
    let profile: AgentProfile | null = null
    if (discovery.identity && deps.readIdentity) {
      profile = await deps.readIdentity(discovery.identity).catch(() => null)
    }
    const identityVerified = isIdentityVerified(discovery.identity, profile)
    deps.log(
      discovery.identity
        ? `Merchant identity: ERC-8004 agent #${discovery.identity.agentId} (${identityVerified ? 'verified on-chain' : 'NOT verified'})` +
            (profile ? `, reputation ${profile.reputation.average ?? 'n/a'} from ${profile.reputation.count} reviews` : '')
        : 'Merchant advertises no ERC-8004 identity',
    )
    return new MerchantSession(discovery, profile, identityVerified, opts.policy, opts.asset, deps)
  }

  get catalog(): CatalogEntry[] {
    return this.discovery.catalog
  }

  entry(operationId: string): CatalogEntry | undefined {
    return this.discovery.catalog.find((e) => e.operationId === operationId)
  }

  async call(entry: CatalogEntry, input: Record<string, unknown>): Promise<PaidCallOutcome> {
    const { deps, discovery, ledger, asset } = this
    const usd = usdFromPrice(entry.price)
    const row: PaidCallOutcome = {
      operationId: entry.operationId, usd, asset, amount: null, decision: 'skipped',
      reason: '', paymentTx: null, sha256: null, feedbackTx: null, synthetic: false, summary: null, data: null,
    }
    const { url, init } = requestFor(discovery.merchant, entry, input)

    const unpaid = await deps.fetch(url, init)
    if (unpaid.status !== 402) {
      row.reason = `expected 402, got ${unpaid.status}`
      return row
    }
    const header = unpaid.headers.get('payment-required') ?? unpaid.headers.get('PAYMENT-REQUIRED')
    if (!header) {
      row.reason = '402 without PAYMENT-REQUIRED header'
      return row
    }
    const required = decodePaymentRequiredHeader(header)
    const requirement = required.accepts.find((r) => (asset === 'HBAR' ? isHbar(r.asset) : !isHbar(r.asset) && r.network === deps.caip2))
    if (!requirement) {
      row.reason = `merchant does not accept ${asset}`
      return row
    }
    row.amount = requirement.amount

    const verdict = ledger.evaluate({
      merchant: discovery.merchant,
      operationId: entry.operationId,
      payTo: requirement.payTo,
      asset: requirement.asset,
      amount: BigInt(requirement.amount),
      advertisedAmount: discovery.advertised.get(advertisedKey(entry.method, entry.path, requirement.asset)),
      usd,
      advertisedPayTo: discovery.payTo ?? undefined,
      identityVerified: this.identityVerified,
    })

    const audit = (decision: AuditSpend['decision'], reason?: string, tx?: string) =>
      deps.audit?.publish({
        v: AUDIT_SCHEMA_ID,
        type: 'spend',
        agent: deps.agentLabel,
        op: entry.operationId,
        merchant: discovery.merchant,
        payTo: requirement.payTo,
        asset: requirement.asset,
        amount: requirement.amount,
        usd,
        network: requirement.network,
        ...(tx ? { tx } : {}),
        decision,
        ...(reason ? { reason: reason.slice(0, 160) } : {}),
        budgetLeftUsd: ledger.remainingUsd,
        ts: new Date().toISOString(),
      })

    if (verdict.decision === 'deny') {
      row.decision = 'denied'
      row.reason = verdict.reason
      deps.log(`  ✗ ${entry.operationId}: denied (${verdict.reason})`)
      audit('denied', verdict.reason)
      return row
    }
    if (verdict.decision === 'approve') {
      const ok = await deps.approve(`Approve ${entry.operationId} for $${usd} (${verdict.reason})?`)
      if (!ok) {
        row.reason = `human declined (${verdict.reason})`
        deps.log(`  – ${entry.operationId}: skipped, ${row.reason}`)
        audit('skipped', row.reason)
        return row
      }
      row.reason = 'approved by human'
    } else {
      row.reason = verdict.reason
    }

    const client = x402Client.fromConfig({
      schemes: [{ network: deps.caip2 as `${string}:${string}`, client: new ExactHederaScheme(deps.signer) }],
      spendControls: hederaSpendControls({ maxUsd: `$${this.policy.maxPerCallUsd}` }),
      paymentRequirementsSelector: (_v, reqs) => {
        const same = reqs.find((r) => r.asset === requirement.asset && r.payTo === requirement.payTo && r.amount === requirement.amount)
        if (!same) throw new Error('payment terms changed between quote and payment')
        return same
      },
    })
    try {
      const response = await wrapFetchWithPayment(deps.fetch, client)(url, init)
      const bytes = Buffer.from(await response.arrayBuffer())
      const receiptHeader = response.headers.get('payment-response') ?? response.headers.get('PAYMENT-RESPONSE')
      const receipt = receiptHeader ? decodePaymentResponseHeader(receiptHeader) : null
      if (!response.ok || !receipt?.success || !receipt.transaction) {
        throw new Error(`HTTP ${response.status}${receipt?.errorReason ? ` (${receipt.errorReason})` : ''}`)
      }
      ledger.record(discovery.merchant, usd)
      row.decision = 'paid'
      row.paymentTx = receipt.transaction
      row.sha256 = createHash('sha256').update(bytes).digest('hex')
      // Payment already settled: an unparseable body must not flip the row to "failed" (the money is spent).
      let body: { data?: unknown; meta?: { synthetic?: boolean } } = {}
      try {
        body = JSON.parse(bytes.toString('utf8'))
      } catch {
        row.reason = `${row.reason}; response body was not JSON`.slice(0, 160)
      }
      row.synthetic = Boolean(body?.meta?.synthetic)
      row.summary = summarize(body?.data)
      row.data = body?.data ?? null
      deps.log(`  ✓ ${entry.operationId}: paid ${asset} tx ${receipt.transaction}${row.synthetic ? ' (labelled synthetic data)' : ''}`)
      audit('paid', row.reason, receipt.transaction)

      if (deps.feedback && discovery.identity && this.identityVerified) {
        try {
          row.feedbackTx = await deps.feedback({
            agentId: BigInt(discovery.identity.agentId),
            score: row.synthetic ? 60 : 100,
            tag1: 'x402',
            tag2: entry.operationId,
            endpoint: url,
            feedbackHash: `0x${row.sha256}`,
          })
          deps.log(`    ERC-8004 feedback ${row.synthetic ? 60 : 100}/100 tx ${row.feedbackTx}`)
        } catch (error) {
          deps.log(`    ERC-8004 feedback failed: ${String((error as Error).message ?? error).slice(0, 120)}`)
        }
      }
    } catch (error) {
      row.decision = 'failed'
      row.reason = String((error as Error).message ?? error).slice(0, 160)
      deps.log(`  ✗ ${entry.operationId}: payment failed (${row.reason})`)
      audit('failed', row.reason)
    }
    return row
  }

  async close() {
    await this.deps.audit?.flush()
  }
}
