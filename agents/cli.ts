/**
 * Finality agents (LLM + Hedera Agent Kit + x402).
 *
 *   npm run agents -- list
 *   npm run agents -- run intelligence --goal "How healthy is the Hedera network and where is HBAR trading?"
 *   npm run agents -- provision intelligence        # HCS-11 profile + own account (≈3 testnet HBAR)
 *   npm run agents -- bench intelligence [--delay 15] # benchmark suite → docs/BENCHMARKS.md
 *   npm run agents -- bench-report                  # rebuild docs/BENCHMARKS.md from stored runs
 *
 * run options:
 *   --goal "<text>"        question (required)
 *   --budget <usd>         x402 budget for the run (default: the agent's policy)
 *   --max-call <usd>       per-call cap;  --approve-above <usd>  human approval threshold
 *   --model <id>           Gemini model (default GEMINI_MODEL or gemini-3.8-flash)
 *   --asset HBAR|USDC      settlement asset (default HBAR)
 *   --merchant <url>       default X402_SERVER_URL or http://localhost:4021
 *   --yes | --no-interactive   auto-approve / auto-decline above the threshold
 *   --no-audit --no-feedback --no-identity   disable HCS spend records / ERC-8004 feedback / merchant identity check
 *   --json                 print the full trace as JSON;  --record  append to docs/AGENT_RUNS.md
 */
import { appendFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { AGENTS, getAgent } from './specs'
import { geminiModel } from './core/model'
import { env, openRunContext, readRegistry } from './core/env'
import { runSpec } from './core/runner'
import type { RunTrace } from './core/trace'
import type { Asset } from '../agent/src/session'

type Args = { _: string[]; [k: string]: string | boolean | string[] }

function parseArgs(argv: string[]): Args {
  const out: Args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) {
      out._.push(a)
      continue
    }
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      out[a.slice(2)] = next
      i++
    } else out[a.slice(2)] = true
  }
  return out
}

const num = (v: unknown, d: number) => (typeof v === 'string' && Number.isFinite(Number(v)) ? Number(v) : d)
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

export function hashscanTx(slug: string, id: string) {
  if (id.includes('@')) {
    const [acct, ts] = id.split('@')
    return `https://hashscan.io/${slug}/transaction/${acct}-${ts.replace('.', '-')}`
  }
  return `https://hashscan.io/${slug}/transaction/${id}`
}

export function printTrace(trace: RunTrace, slug: string) {
  console.log(`\n${trace.text || '(no answer)'}\n`)
  console.log('— Sources')
  for (const c of trace.toolCalls) {
    const id = c.sourceId ?? '  '
    const pay = c.payment ? ` $${c.payment.usd} ${c.payment.decision}${c.payment.tx ? ` ${hashscanTx(slug, c.payment.tx)}` : ''}${c.payment.synthetic ? ' (synthetic)' : ''}` : ''
    console.log(`  ${id.padEnd(4)} ${c.tool} ${JSON.stringify(c.args)}${pay}${c.ok ? '' : `  ✗ ${c.error ?? ''}`}`)
  }
  console.log(
    `— ${trace.model} · ${trace.steps} steps · ${trace.toolCalls.length} tool calls · ${trace.usage.totalTokens} tokens · ` +
      `${(trace.durationMs / 1000).toFixed(1)} s · spent $${trace.spentUsd.toFixed(2)} of $${trace.budgetUsd}` +
      (trace.unknownCitations.length ? ` · UNKNOWN CITATIONS ${trace.unknownCitations.join(', ')}` : ''),
  )
  if (trace.error) console.log(`— error: ${trace.error}`)
}

async function record(trace: RunTrace, slug: string) {
  const lines = [
    `\n## ${trace.startedAt} — ${trace.agentName}: "${trace.goal}"`,
    '',
    `${trace.model}, ${trace.steps} steps, ${trace.usage.totalTokens} tokens, ${(trace.durationMs / 1000).toFixed(1)} s, spent $${trace.spentUsd.toFixed(2)} of $${trace.budgetUsd}.`,
    '',
    '| Source | Tool | Args | Payment |',
    '|---|---|---|---|',
    ...trace.toolCalls.map(
      (c) => `| ${c.sourceId ?? '—'} | \`${c.tool}\` | \`${JSON.stringify(c.args).slice(0, 80)}\` | ${c.payment ? `$${c.payment.usd} ${c.payment.decision}${c.payment.tx ? ` [tx](${hashscanTx(slug, c.payment.tx)})` : ''}` : '—'} |`,
    ),
    '',
    trace.text.split('\n').map((l) => `> ${l}`).join('\n'),
    '',
  ]
  await appendFile('docs/AGENT_RUNS.md', lines.join('\n'))
  console.log('Recorded in docs/AGENT_RUNS.md')
}

async function cmdRun(a: Args) {
  const spec = getAgent(a._[1] ?? '')
  const goal = str(a.goal)
  if (!goal) throw new Error(`Usage: npm run agents -- run ${spec.id} --goal "<question>"`)
  const { model, modelId } = geminiModel(str(a.model) ?? spec.model)
  const rl = a.yes || a['no-interactive'] ? null : createInterface({ input: process.stdin, output: process.stdout })
  const ctx = await openRunContext(spec, {
    merchant: (str(a.merchant) ?? env('X402_SERVER_URL') ?? 'http://localhost:4021').replace(/\/$/, ''),
    budgetUsd: num(a.budget, spec.policy.budgetUsd),
    maxPerCallUsd: num(a['max-call'], spec.policy.maxPerCallUsd),
    approvalAboveUsd: num(a['approve-above'], spec.policy.approvalAboveUsd),
    asset: (str(a.asset)?.toUpperCase() === 'USDC' ? 'USDC' : 'HBAR') as Asset,
    requireIdentity: !a['no-identity'],
    audit: !a['no-audit'],
    feedback: !a['no-feedback'],
    approve: async (q) => {
      if (a.yes) return true
      if (!rl) return false
      return /^y(es)?$/i.test((await rl.question(`  ? ${q} [y/N] `)).trim())
    },
    log: (l) => console.log(l),
  })
  console.log(`${spec.name} as ${ctx.accountId} — ${ctx.accountSource}`)
  try {
    const trace = await runSpec({ spec, goal, model, modelId, client: ctx.client, accountId: ctx.accountId, network: ctx.network, session: ctx.session, log: (l) => console.log(l) })
    if (a.json) console.log(JSON.stringify(trace, null, 2))
    else printTrace(trace, ctx.slug)
    if (ctx.audit) console.log(`HCS audit: ${ctx.audit.published.length} spend record(s) → https://hashscan.io/${ctx.slug}/topic/${env('HCS_AUDIT_TOPIC_ID')}`)
    if (a.record) await record(trace, ctx.slug)
    if (trace.error) process.exitCode = 1
  } finally {
    rl?.close()
    await ctx.close()
  }
}

function cmdList() {
  const network = env('X402_NETWORK') ?? 'hedera-testnet'
  const registry = readRegistry(network)
  for (const spec of Object.values(AGENTS)) {
    const r = registry[spec.id]
    console.log(`${spec.id.padEnd(14)} ${spec.name}`)
    console.log(`${' '.repeat(15)}${spec.bio}`)
    console.log(`${' '.repeat(15)}tools: ${spec.hederaPlugins.map((p) => p.name).join(', ')}${spec.finality ? ', finality-intelligence' : ''} · budget $${spec.policy.budgetUsd} · ${spec.maxSteps} steps`)
    console.log(`${' '.repeat(15)}HCS-11: ${r ? `${r.accountId} (inbound ${r.inboundTopicId})` : 'not provisioned'}`)
  }
}

async function main() {
  const a = parseArgs(process.argv.slice(2))
  const cmd = a._[0]
  if (cmd === 'list' || !cmd) return cmdList()
  if (cmd === 'run') return cmdRun(a)
  if (cmd === 'provision') return (await import('./core/provision')).cmdProvision(a._[1] ?? '', { registry: !a['no-registry'] })
  if (cmd === 'bench') return (await import('./bench/run')).cmdBench(a)
  if (cmd === 'bench-report') return (await import('./bench/run')).writeReport()
  throw new Error(`Unknown command "${cmd}". Use list | run | provision | bench | bench-report`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
