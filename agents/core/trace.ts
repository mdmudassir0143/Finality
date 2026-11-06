/** Everything a run produced, used for the CLI report, benchmarks and (later) the agents page. */

export type SourceKind = 'finality' | 'hedera' | 'meta'

export type ToolCallTrace = {
  /** Citation id the model is told to use, e.g. "S3". Only data-returning tools get one. */
  sourceId: string | null
  kind: SourceKind
  tool: string
  args: unknown
  ok: boolean
  ms: number
  error?: string
  /** For paid Finality calls: the settlement and the hash of the bytes delivered. */
  payment?: { operationId: string; usd: number; tx: string | null; sha256: string | null; decision: string; synthetic: boolean }
}

export type RunTrace = {
  agentId: string
  agentName: string
  goal: string
  model: string
  startedAt: string
  durationMs: number
  steps: number
  finishReason: string
  usage: { inputTokens: number; outputTokens: number; totalTokens: number }
  toolCalls: ToolCallTrace[]
  spentUsd: number
  budgetUsd: number
  /** Final answer (markdown brief with [S#] citations). */
  text: string
  /** Citation ids used in the text that do not match any tool call (should be empty). */
  unknownCitations: string[]
  error?: string
}

export function citationsIn(text: string): string[] {
  return [...new Set([...text.matchAll(/\[(S\d+)\]/g)].map((m) => m[1]))]
}
