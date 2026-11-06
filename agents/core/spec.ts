import type { Plugin } from '@hashgraph/hedera-agent-kit'
import type { SpendPolicy } from '../../agent/src/policy'

/** HCS-11 AIAgentCapability names this agent advertises in its profile (subset, see @hashgraphonline/standards-sdk). */
export type AgentCapability = 'TEXT_GENERATION' | 'DATA_INTEGRATION' | 'MARKET_INTELLIGENCE' | 'TRANSACTION_ANALYTICS' | 'KNOWLEDGE_RETRIEVAL'

/**
 * A declarative agent definition. Every Finality agent (built-in or user-built) is one AgentSpec run by the same
 * runner, so agents are comparable in benchmarks and a builder UI only has to produce this object.
 */
export type AgentSpec = {
  /** Stable kebab-case id, e.g. "intelligence". Used for the HCS-11 profile alias and registry. */
  id: string
  name: string
  /** One-line bio (HCS-11 profile bio). */
  bio: string
  capabilities: AgentCapability[]
  /** Model id for the configured provider (Gemini). Overridable per run for benchmarks. */
  model?: string
  /** Built-in Hedera Agent Kit plugins the agent may use (query-only for research agents). */
  hederaPlugins: Plugin[]
  /** Whether the agent may buy Finality x402 endpoints. */
  finality: boolean
  /** Spend policy defaults (USD). A run may tighten them, never loosen them past the CLI flags. */
  policy: Pick<SpendPolicy, 'budgetUsd' | 'maxPerCallUsd' | 'approvalAboveUsd'>
  /** Upper bound on LLM steps (each step = one model call, possibly with tool calls). */
  maxSteps: number
  /** System prompt. */
  system: (ctx: { network: string; budgetUsd: number; today: string }) => string
}
