import { citationsIn, type RunTrace } from '../core/trace'

export type BenchTask = {
  id: string
  goal: string
  /** x402 budget given to the agent for this task. */
  budgetUsd: number
  /** Spend above this fails the cost check (0 = the task must be answered with free tools). */
  maxUsd: number
  /** At least one of these tools / operationIds must have succeeded. */
  mustUseAny?: string[]
  /** All of these tools / operationIds must have succeeded. */
  mustUseAll?: string[]
  /** Case-insensitive regexes the answer must match. */
  mustMention?: string[]
  minCitations?: number
}

export type BenchSuite = { suite: string; agent: string; description: string; tasks: BenchTask[] }

export type Check = { name: string; pass: boolean; detail: string }

/** pass/fail measure the agent; error means the model provider failed (quota, rate limit, overload). */
export type TaskStatus = 'pass' | 'fail' | 'error'

export type TaskScore = {
  taskId: string
  status: TaskStatus
  pass: boolean
  /** Fraction of checks passed, 0..1. */
  score: number
  checks: Check[]
  spentUsd: number
  durationMs: number
  steps: number
  toolCalls: number
  totalTokens: number
}

/** Names a successful call answers to: the tool method, and for paid Finality calls also the operationId. */
function usedNames(trace: RunTrace): Set<string> {
  const names = new Set<string>()
  for (const c of trace.toolCalls) {
    if (!c.ok) continue
    names.add(c.tool)
    if (c.payment?.operationId) names.add(c.payment.operationId)
  }
  return names
}

const PROVIDER_ERROR = /quota|rate.?limit|\b429\b|\b503\b|high demand|overloaded|unavailable|resource.?exhausted/i

/** A run that never got a usable answer because the model provider failed — not the agent's fault. */
export function isProviderError(trace: RunTrace): boolean {
  return Boolean(trace.error && PROVIDER_ERROR.test(trace.error))
}

/** Deterministic scoring of one run against one task. No LLM judge: every check is reproducible from the trace. */
export function scoreTask(task: BenchTask, trace: RunTrace): TaskScore {
  const checks: Check[] = []
  const used = usedNames(trace)
  const cited = citationsIn(trace.text)

  checks.push({ name: 'completed', pass: !trace.error && trace.text.trim().length > 0, detail: trace.error ?? `${trace.text.length} chars` })
  if (task.mustUseAny?.length) {
    const hit = task.mustUseAny.filter((n) => used.has(n))
    checks.push({ name: 'right-source', pass: hit.length > 0, detail: hit.length ? hit.join(', ') : `none of ${task.mustUseAny.join(', ')}` })
  }
  if (task.mustUseAll?.length) {
    const missing = task.mustUseAll.filter((n) => !used.has(n))
    checks.push({ name: 'all-sources', pass: missing.length === 0, detail: missing.length ? `missing ${missing.join(', ')}` : 'all used' })
  }
  for (const pattern of task.mustMention ?? []) {
    const ok = new RegExp(pattern, 'i').test(trace.text)
    checks.push({ name: `mentions /${pattern}/`, pass: ok, detail: ok ? 'found' : 'not in answer' })
  }
  const min = task.minCitations ?? 1
  checks.push({ name: 'cited', pass: cited.length >= min, detail: `${cited.length} citation(s), need ${min}` })
  checks.push({ name: 'no-invented-citations', pass: trace.unknownCitations.length === 0, detail: trace.unknownCitations.join(', ') || 'none' })
  checks.push({
    name: task.maxUsd === 0 ? 'free-tools-only' : 'within-cost',
    pass: trace.spentUsd <= task.maxUsd + 1e-9,
    detail: `$${trace.spentUsd.toFixed(2)} of max $${task.maxUsd.toFixed(2)}`,
  })

  const passed = checks.filter((c) => c.pass).length
  const status: TaskStatus = isProviderError(trace) ? 'error' : passed === checks.length ? 'pass' : 'fail'
  return {
    taskId: task.id,
    status,
    pass: status === 'pass',
    score: checks.length ? passed / checks.length : 0,
    checks,
    spentUsd: trace.spentUsd,
    durationMs: trace.durationMs,
    steps: trace.steps,
    toolCalls: trace.toolCalls.length,
    totalTokens: trace.usage.totalTokens,
  }
}

export type SuiteSummary = {
  suite: string
  agent: string
  model: string
  ranAt: string
  tasks: number
  /** Tasks the provider failed on (excluded from pass rate and means). */
  errors: number
  passed: number
  /** passed / scored tasks (tasks minus errors). */
  passRate: number
  meanScore: number
  totalSpentUsd: number
  meanLatencyS: number
  meanSteps: number
  meanToolCalls: number
  meanTokens: number
}

export function summarize(suite: BenchSuite, model: string, all: TaskScore[], ranAt: string): SuiteSummary {
  const scores = all.filter((s) => s.status !== 'error')
  const n = scores.length || 1
  const mean = (f: (s: TaskScore) => number) => scores.reduce((a, s) => a + f(s), 0) / n
  const passed = scores.filter((s) => s.pass).length
  return {
    suite: suite.suite,
    agent: suite.agent,
    model,
    ranAt,
    tasks: all.length,
    errors: all.length - scores.length,
    passed,
    passRate: scores.length ? passed / scores.length : 0,
    meanScore: mean((s) => s.score),
    totalSpentUsd: Math.round(all.reduce((a, s) => a + s.spentUsd, 0) * 1e6) / 1e6,
    meanLatencyS: mean((s) => s.durationMs) / 1000,
    meanSteps: mean((s) => s.steps),
    meanToolCalls: mean((s) => s.toolCalls),
    meanTokens: mean((s) => s.totalTokens),
  }
}
