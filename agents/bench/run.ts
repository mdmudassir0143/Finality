/**
 * Benchmark an agent on its task suite (live: real Gemini calls and real x402 payments on Hedera testnet).
 *
 *   npm run agents -- bench intelligence [--model gemini-3.8-flash] [--only hbar-price,sentiment] [--no-audit]
 *
 * Writes agents/bench/results/<suite>-<model>-<timestamp>.json (traces + scores) and appends a summary row and
 * per-task table to docs/BENCHMARKS.md. Each task gets a fresh x402 session with its own budget.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { getAgent } from '../specs'
import { geminiModel } from '../core/model'
import { env, openRunContext } from '../core/env'
import { runSpec } from '../core/runner'
import type { RunTrace } from '../core/trace'
import { scoreTask, summarize, type BenchSuite, type TaskScore } from './score'
import { loadRuns, loadSuiteFile, renderReport } from './results'

type Args = { _: string[]; [k: string]: string | boolean | string[] }
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

export function loadSuite(agentId: string): BenchSuite {
  const suite = loadSuiteFile(agentId)
  if (!suite) throw new Error(`No benchmark suite for "${agentId}" (agents/bench/tasks/${agentId}.json)`)
  return suite
}

/** Rebuild docs/BENCHMARKS.md from every stored run. */
export function writeReport() {
  writeFileSync('docs/BENCHMARKS.md', renderReport(loadRuns()))
}

export async function cmdBench(a: Args) {
  const spec = getAgent(a._[1] ?? '')
  const suite = loadSuite(spec.id)
  const only = str(a.only)?.split(',').map((s) => s.trim())
  const tasks = suite.tasks.filter((t) => !only || only.includes(t.id))
  const { model, modelId } = geminiModel(str(a.model) ?? spec.model)
  const ranAt = new Date().toISOString()
  const merchant = (str(a.merchant) ?? env('X402_SERVER_URL') ?? 'http://localhost:4021').replace(/\/$/, '')

  const delayS = typeof a.delay === 'string' && Number.isFinite(Number(a.delay)) ? Number(a.delay) : 15
  console.log(`Benchmark ${suite.suite} · ${spec.name} · ${modelId} · ${tasks.length} task(s) · ${delayS} s between tasks`)
  const scores: TaskScore[] = []
  const traces: RunTrace[] = []
  for (const [i, task] of tasks.entries()) {
    // Pace requests so free-tier per-minute quotas are not exhausted mid-suite.
    if (i > 0 && delayS > 0) await new Promise((r) => setTimeout(r, delayS * 1000))
    console.log(`\n▶ ${task.id}: ${task.goal}`)
    const ctx = await openRunContext(spec, {
      merchant,
      budgetUsd: task.budgetUsd,
      maxPerCallUsd: Math.min(spec.policy.maxPerCallUsd, task.budgetUsd),
      approvalAboveUsd: task.budgetUsd, // no human in a benchmark: anything within budget is allowed
      asset: 'HBAR',
      requireIdentity: true,
      audit: !a['no-audit'],
      feedback: false, // benchmarks must not move the merchant's on-chain reputation
      approve: async () => false,
      log: (l) => console.log(l),
    })
    try {
      const trace = await runSpec({ spec, goal: task.goal, model, modelId, client: ctx.client, accountId: ctx.accountId, network: ctx.network, session: ctx.session, log: (l) => console.log(l) })
      const score = scoreTask(task, trace)
      traces.push(trace)
      scores.push(score)
      console.log(`  ${score.status.toUpperCase()} ${(score.score * 100).toFixed(0)}% · $${trace.spentUsd.toFixed(2)} · ${(trace.durationMs / 1000).toFixed(1)} s`)
      if (score.status === 'error') console.log(`    provider error: ${trace.error?.split('\n')[0].slice(0, 160)}`)
      else for (const c of score.checks.filter((c) => !c.pass)) console.log(`    ✗ ${c.name}: ${c.detail}`)
    } finally {
      await ctx.close()
    }
  }

  const summary = summarize({ ...suite, tasks }, modelId, scores, ranAt)
  const dir = path.join(process.cwd(), 'agents', 'bench', 'results')
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${suite.suite}-${modelId}-${ranAt.replace(/[:.]/g, '-')}.json`)
  writeFileSync(file, JSON.stringify({ summary, scores, traces }, null, 2) + '\n')
  writeReport()

  console.log(
    `\n${summary.passed}/${summary.tasks - summary.errors} passed${summary.errors ? ` (${summary.errors} provider errors)` : ''} · mean score ${(summary.meanScore * 100).toFixed(0)}% · spent $${summary.totalSpentUsd.toFixed(2)} · ` +
      `${summary.meanLatencyS.toFixed(1)} s/task · ${summary.meanToolCalls.toFixed(1)} tool calls/task\nSaved ${file} and docs/BENCHMARKS.md`,
  )
}
