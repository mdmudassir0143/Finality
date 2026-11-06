import { readFileSync } from 'node:fs'
import path from 'node:path'
import { AGENT_META, type AgentMeta } from '@/agents/specs/meta'
import type { SuiteSummary, TaskScore } from '@/agents/bench/score'
import { loadRuns, loadSuiteFile } from '@/agents/bench/results'

export type AgentIdentity = {
  accountId: string
  inboundTopicId: string
  outboundTopicId: string
  profileTopicId?: string
  stage?: string
  createdAt: string
}

export type ModelResult = {
  model: string
  summary: SuiteSummary
  tasks: Array<Pick<TaskScore, 'taskId' | 'status' | 'pass' | 'score' | 'spentUsd' | 'durationMs' | 'toolCalls'> & { failed: string[] }>
}

export type AgentView = {
  meta: AgentMeta
  identity: AgentIdentity | null
  /** Spend-record label the agent writes to the HCS audit topic. */
  auditLabel: string | null
  suite: { id: string; tasks: Array<{ id: string; goal: string; maxUsd: number }> } | null
  /** Latest benchmark run per model, best pass rate first. */
  results: ModelResult[]
}

const root = process.cwd()
const readJson = <T,>(file: string): T | null => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

/** Reads the agent registry and benchmark results from the repo (evaluated at build/render time on the server). */
export function loadAgents(network = process.env.X402_NETWORK?.trim() || 'hedera-testnet'): AgentView[] {
  const registry = readJson<Record<string, AgentIdentity>>(path.join(root, 'agents', 'registry', `${network}.json`)) ?? {}
  const runs = loadRuns(root)

  return AGENT_META.map((meta) => {
    const identity = registry[meta.id] ?? null
    const suiteFile = loadSuiteFile(meta.suite, root)
    const latest = new Map<string, { summary: SuiteSummary; scores: TaskScore[] }>()
    for (const run of runs) {
      if (run.summary.agent !== meta.id) continue
      // Only full-suite runs are comparable across models.
      if (suiteFile && run.summary.tasks !== suiteFile.tasks.length) continue
      const prev = latest.get(run.summary.model)
      if (!prev || prev.summary.ranAt < run.summary.ranAt) latest.set(run.summary.model, run)
    }
    const results: ModelResult[] = [...latest.values()]
      .map(({ summary, scores }) => ({
        model: summary.model,
        summary,
        tasks: scores.map((s) => ({
          taskId: s.taskId,
          status: s.status,
          pass: s.pass,
          score: s.score,
          spentUsd: s.spentUsd,
          durationMs: s.durationMs,
          toolCalls: s.toolCalls,
          failed: s.checks.filter((c) => !c.pass).map((c) => c.name),
        })),
      }))
      .sort((a, b) => b.summary.passRate - a.summary.passRate || b.summary.meanScore - a.summary.meanScore)
    return {
      meta,
      identity,
      auditLabel: identity ? `hcs11:${identity.accountId}:${meta.id}` : null,
      suite: suiteFile ? { id: suiteFile.suite, tasks: suiteFile.tasks.map((t) => ({ id: t.id, goal: t.goal, maxUsd: t.maxUsd })) } : null,
      results,
    }
  })
}
