/**
 * Spending policy for the Finality research agent. Every paid call is checked here before anything is signed.
 *
 * Order of checks (first failure wins):
 *  1. identity   – the merchant must have a verified ERC-8004 identity (when required)
 *  2. payTo      – the 402's payTo must be allowlisted (explicit list, else the payTo the merchant advertised
 *                  in discovery). This blocks payee bait-and-switch between discovery and the 402.
 *  3. price      – the 402 amount must not exceed what discovery advertised for that asset
 *  4. per-call   – USD cost ≤ maxPerCallUsd
 *  5. budget     – total spent + cost ≤ budgetUsd
 *  6. merchant   – spent at this merchant + cost ≤ perMerchantUsd
 *  7. approval   – cost > approvalAboveUsd needs a human yes (human-in-the-loop); otherwise fully autonomous
 */
export type SpendPolicy = {
  budgetUsd: number
  maxPerCallUsd: number
  perMerchantUsd: number
  approvalAboveUsd: number
  allowedPayTo: string[]
  requireIdentity: boolean
}

export type SpendRequest = {
  merchant: string
  operationId: string
  payTo: string
  asset: string
  /** Atomic amount in the 402 (tinybars or USDC base units). */
  amount: bigint
  /** Atomic amount advertised for this asset in discovery, if known. */
  advertisedAmount?: bigint
  usd: number
  advertisedPayTo?: string
  identityVerified: boolean
}

export type PolicyDecision =
  | { decision: 'allow'; reason: string }
  | { decision: 'approve'; reason: string }
  | { decision: 'deny'; reason: string }

/**
 * Money is tracked in integer micro-USD (1e-6). Summing floats drifts (0.1 + 0.2 !== 0.3), which can let a
 * run overshoot its budget or deny a call that exactly fits. Inputs are rounded once to micros, then all
 * comparisons and accumulation are exact integer arithmetic.
 */
export const MICROS_PER_USD = 1_000_000
export const toMicros = (usd: number): number => {
  if (!Number.isFinite(usd) || usd < 0) throw new Error(`Invalid USD amount: ${usd}`)
  return Math.round(usd * MICROS_PER_USD)
}
const fromMicros = (micros: number) => micros / MICROS_PER_USD

/** Hedera ids compare exactly; EVM addresses are case-insensitive (EIP-55 checksum casing varies). */
const samePayee = (a: string, b: string) => (/^0x[0-9a-fA-F]{40}$/.test(a) ? a.toLowerCase() === b.toLowerCase() : a === b)

export class SpendLedger {
  /** Integer micro-USD. */
  private spent = 0
  private byMerchant = new Map<string, number>()

  constructor(readonly policy: SpendPolicy) {}

  get spentUsd() {
    return fromMicros(this.spent)
  }

  get remainingUsd() {
    return fromMicros(toMicros(this.policy.budgetUsd) - this.spent)
  }

  evaluate(req: SpendRequest): PolicyDecision {
    const p = this.policy
    if (p.requireIdentity && !req.identityVerified) {
      return { decision: 'deny', reason: 'merchant has no verified ERC-8004 identity' }
    }
    const allowed = p.allowedPayTo.length ? p.allowedPayTo : req.advertisedPayTo ? [req.advertisedPayTo] : []
    if (!allowed.some((a) => samePayee(a, req.payTo))) {
      return { decision: 'deny', reason: `payTo ${req.payTo} is not allowlisted` }
    }
    // Fail closed: with no advertised amount for this asset there is nothing to check the 402 against, and the
    // USD caps below use the catalog price, not the atomic amount actually being signed.
    if (req.advertisedAmount === undefined) {
      return { decision: 'deny', reason: `discovery advertised no amount for ${req.asset}; cannot verify the 402 price` }
    }
    if (req.amount > req.advertisedAmount) {
      return { decision: 'deny', reason: `402 asks ${req.amount} but discovery advertised ${req.advertisedAmount}` }
    }
    const cost = toMicros(req.usd)
    if (cost > toMicros(p.maxPerCallUsd)) {
      return { decision: 'deny', reason: `$${req.usd} exceeds per-call cap $${p.maxPerCallUsd}` }
    }
    if (this.spent + cost > toMicros(p.budgetUsd)) {
      return { decision: 'deny', reason: `$${req.usd} exceeds remaining budget $${this.remainingUsd}` }
    }
    const merchantSpent = this.byMerchant.get(req.merchant) ?? 0
    if (merchantSpent + cost > toMicros(p.perMerchantUsd)) {
      return { decision: 'deny', reason: `per-merchant cap $${p.perMerchantUsd} reached` }
    }
    if (cost > toMicros(p.approvalAboveUsd)) {
      return { decision: 'approve', reason: `$${req.usd} is above the approval threshold $${p.approvalAboveUsd}` }
    }
    return { decision: 'allow', reason: 'within policy' }
  }

  record(merchant: string, usd: number) {
    const cost = toMicros(usd)
    this.spent += cost
    this.byMerchant.set(merchant, (this.byMerchant.get(merchant) ?? 0) + cost)
  }
}
