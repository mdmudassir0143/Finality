/**
 * Stored benchmark runs (agents/bench/results/*.json). Scores are always recomputed from the stored traces with the
 * current scorer, so the agents page and docs/BENCHMARKS.md never show stale or inconsistent numbers.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { RunTrace } from '../core/trace'
import { scoreTask, summarize, type BenchSuite, type SuiteSummary, type TaskScore } from './score'

export type StoredRun = { file: string; summary: SuiteSummary; scores: TaskScore[] }

export function loadSuiteFile(agentId: string, root = process.cwd()): BenchSuite | null {
  const file = path.join(root, 'agents', 'bench', 'tasks', `${agentId}.json`)
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as BenchSuite) : null
}

export function loadRuns(root = process.cwd()): StoredRun[] {
  const dir = path.join(root, 'agents', 'bench', 'results')
  if (!existsSync(dir)) return []
  const runs: StoredRun[] = []
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    try {
      const raw = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as { summary: SuiteSummary; scores: TaskScore[]; traces: RunTrace[] }
      const suite = loadSuiteFile(raw.summary.agent, root)
      if (!suite || !raw.traces?.length) continue
      const scores: TaskScore[] = []
      raw.scores.forEach((old, i) => {
        const task = suite.tasks.find((t) => t.id === old.taskId)
        const trace = raw.traces[i]
        if (task && trace) scores.push(scoreTask(task, trace))
      })
      runs.push({ file: `agents/bench/results/${name}`, summary: summarize(suite, raw.summary.model, scores, raw.summary.ranAt), scores })
    } catch {
      /* skip unreadable files */
    }
  }
  return runs
}

/** docs/BENCHMARKS.md, regenerated from every stored run (newest first). */
export function renderReport(runs: StoredRun[]): string {
  const lines = [
    '# Agent benchmarks',
    '',
    'Live runs of `npm run agents -- bench <agent>`: real model calls and real x402 payments on Hedera testnet.',
    'Scoring is deterministic (agents/bench/score.ts). ERROR = the model provider failed (quota, rate limit, overload);',
    'those tasks are excluded from pass rate and means. Regenerated from agents/bench/results on every run.',
  ]
  for (const r of [...runs].sort((a, b) => b.summary.ranAt.localeCompare(a.summary.ranAt))) {
    const s = r.summary
    lines.push(
      '',
      `## ${s.ranAt} — ${s.agent} · ${s.model} · ${s.suite}`,
      '',
      `**${s.passed}/${s.tasks - s.errors} passed**${s.errors ? ` (${s.errors} provider error${s.errors > 1 ? 's' : ''})` : ''} · mean score ${(s.meanScore * 100).toFixed(0)}% · ` +
        `spent $${s.totalSpentUsd.toFixed(2)} · ${s.meanLatencyS.toFixed(1)} s/task · ${s.meanSteps.toFixed(1)} steps · ${s.meanToolCalls.toFixed(1)} tool calls · ` +
        `${Math.round(s.meanTokens)} tokens/task. Raw: \`${r.file}\``,
      '',
      '| Task | Result | Score | Spent | Latency | Failed checks |',
      '|---|---|---|---|---|---|',
      ...r.scores.map(
        (t) =>
          `| ${t.taskId} | ${t.status.toUpperCase()} | ${t.status === 'error' ? '—' : `${(t.score * 100).toFixed(0)}%`} | $${t.spentUsd.toFixed(2)} | ${(t.durationMs / 1000).toFixed(1)} s | ${
            t.status === 'error' ? 'provider error' : t.checks.filter((c) => !c.pass).map((c) => c.name).join(', ') || '—'
          } |`,
      ),
    )
  }
  return lines.join('\n') + '\n'
}
