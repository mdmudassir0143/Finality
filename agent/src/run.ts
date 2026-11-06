import type { AgentProfile } from '../../lib/evm/erc8004'
import type { MerchantIdentity } from './discovery'
import { planCalls, type PlannedCall } from './planner'
import type { SpendPolicy } from './policy'
import { MerchantSession, type AgentDeps, type Asset, type CallResult } from './session'

export type { AgentDeps, Asset, CallResult } from './session'

export type RunReport = {
  goal: string
  merchant: string
  merchantIdentity: MerchantIdentity | null
  identityVerified: boolean
  merchantReputation: AgentProfile['reputation'] | null
  plan: PlannedCall[]
  results: CallResult[]
  spentUsd: number
  remainingUsd: number
}

/**
 * Deterministic research agent: discover → keyword plan → pay each planned call through a MerchantSession
 * (402 → policy → approval → pay → receipt → HCS spend record → ERC-8004 feedback).
 * The LLM agents in agents/ reuse the same MerchantSession, so both share one spend policy.
 */
export async function runAgent(
  opts: { merchant: string; goal: string; policy: SpendPolicy; asset: Asset; maxCalls?: number; only?: string[] },
  deps: AgentDeps,
): Promise<RunReport> {
  const session = await MerchantSession.open({ merchant: opts.merchant, policy: opts.policy, asset: opts.asset }, deps)
  const plan = planCalls(opts.goal, session.catalog, { budgetUsd: opts.policy.budgetUsd, maxCalls: opts.maxCalls, only: opts.only })
  deps.log(`Plan for "${opts.goal}": ${plan.map((c) => `${c.operationId} (${c.price})`).join(', ') || 'nothing relevant within budget'}`)

  const results: CallResult[] = []
  for (const call of plan) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { data, ...row } = await session.call(call, call.input)
    results.push(row)
  }

  await session.close()
  return {
    goal: opts.goal,
    merchant: session.discovery.merchant,
    merchantIdentity: session.discovery.identity,
    identityVerified: session.identityVerified,
    merchantReputation: session.profile?.reputation ?? null,
    plan,
    results,
    spentUsd: session.ledger.spentUsd,
    remainingUsd: session.ledger.remainingUsd,
  }
}
