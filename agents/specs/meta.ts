/**
 * Plain, serializable agent metadata (no SDK imports), shared by the AgentSpecs and the /explore/agents page.
 * Keep the runtime spec (agents/specs/<id>.ts) and this entry in sync by building the spec from it.
 */
import type { AgentCapability } from '../core/spec'

export type AgentMeta = {
  id: string
  name: string
  bio: string
  role: string
  capabilities: AgentCapability[]
  /** Hedera Agent Kit plugin names the agent loads (display). */
  plugins: string[]
  /** Buys Finality x402 endpoints. */
  finality: boolean
  policy: { budgetUsd: number; maxPerCallUsd: number; approvalAboveUsd: number }
  maxSteps: number
  /** Benchmark suite id in agents/bench/tasks/<id>.json. */
  suite: string
  example: string
}

export const INTELLIGENCE_META: AgentMeta = {
  id: 'intelligence',
  name: 'Finality Intelligence Analyst',
  bio: 'Budget-aware research agent: buys Finality x402 market and Hedera data, reads the Hedera network, and writes cited briefs.',
  role: 'Research',
  capabilities: ['MARKET_INTELLIGENCE', 'TRANSACTION_ANALYTICS', 'DATA_INTEGRATION', 'TEXT_GENERATION'],
  plugins: ['core-account-query', 'core-token-query', 'core-consensus-query', 'core-transaction-query', 'core-misc-queries', 'finality-intelligence'],
  finality: true,
  policy: { budgetUsd: 1, maxPerCallUsd: 0.5, approvalAboveUsd: 0.5 },
  maxSteps: 12,
  suite: 'intelligence',
  example: "What is HBAR's price and how healthy is the Hedera network?",
}

export const AGENT_META: AgentMeta[] = [INTELLIGENCE_META]
