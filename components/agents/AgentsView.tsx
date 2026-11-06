'use client'

import { useEffect, useState } from 'react'
import { ArrowUpRight, Bot, Check, Copy, Loader2 } from 'lucide-react'
import type { AgentView, ModelResult } from '@/lib/agents/data'
import { HEDERA_NETWORK, MIRROR_NODE_URL } from '@/lib/hedera/config'
import { cn } from '@/lib/utils'

const slug = HEDERA_NETWORK === 'hedera-mainnet' ? 'mainnet' : 'testnet'
const hashscan = (kind: 'account' | 'topic', id: string) => `https://hashscan.io/${slug}/${kind}/${id}`
const pct = (n: number) => `${Math.round(n * 100)}%`
const usd = (n: number) => `$${n.toFixed(2)}`

export default function AgentsView({ agents }: { agents: AgentView[] }) {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight uppercase">Agents</h1>
        <p className="mt-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {agents.length} agent{agents.length === 1 ? '' : 's'} · Hedera Agent Kit · x402 · HCS-11
        </p>
      </div>
      {agents.map((a) => (
        <AgentSection key={a.meta.id} agent={a} />
      ))}
    </div>
  )
}

function AgentSection({ agent }: { agent: AgentView }) {
  const { meta, identity } = agent
  const verified = identity?.stage === 'verified' || identity?.stage === 'complete'
  return (
    <section className="space-y-6" aria-labelledby={`agent-${meta.id}`}>
      <div className="border border-border p-5 space-y-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-3 min-w-0">
            <span className="h-10 w-10 shrink-0 border border-border inline-flex items-center justify-center">
              <Bot className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id={`agent-${meta.id}`} className="text-lg font-bold">{meta.name}</h2>
                <Tag>{meta.role}</Tag>
                {verified && <Tag tone="ok">HCS-11</Tag>}
              </div>
              <p className="mt-1 text-sm text-muted-foreground max-w-2xl">{meta.bio}</p>
            </div>
          </div>
          <Balance accountId={identity?.accountId} />
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <IdCell label="Account" id={identity?.accountId} kind="account" />
          <IdCell label="Profile (HCS-1)" id={identity?.profileTopicId} kind="topic" />
          <IdCell label="Inbound (HCS-10)" id={identity?.inboundTopicId} kind="topic" />
          <IdCell label="Outbound (HCS-10)" id={identity?.outboundTopicId} kind="topic" />
        </div>

        <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
          <Stat label="Budget / run" value={usd(meta.policy.budgetUsd)} />
          <Stat label="Per-call cap" value={usd(meta.policy.maxPerCallUsd)} />
          <Stat label="Max steps" value={String(meta.maxSteps)} />
          <Stat label="Model" value="Gemini" />
        </div>

        <div className="space-y-2">
          <Label>Tools</Label>
          <div className="flex flex-wrap gap-1">
            {meta.plugins.map((p) => (
              <Tag key={p}>{p}</Tag>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <Label>Capabilities</Label>
          <div className="flex flex-wrap gap-1">
            {meta.capabilities.map((c) => (
              <Tag key={c}>{c.replace(/_/g, ' ').toLowerCase()}</Tag>
            ))}
          </div>
        </div>
        <RunCommand id={meta.id} example={meta.example} />
      </div>

      <Benchmarks agent={agent} />
      <Activity label={agent.auditLabel} />
    </section>
  )
}

function Benchmarks({ agent }: { agent: AgentView }) {
  const { results, suite } = agent
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em]">Benchmarks</h3>
        {suite && <span className="mono text-[10px] text-muted-foreground">{suite.id} · {suite.tasks.length} tasks</span>}
      </div>
      {results.length === 0 ? (
        <Empty>
          No benchmark yet · <code className="mono">npm run agents -- bench {agent.meta.id}</code>
        </Empty>
      ) : (
        <>
          <div className="border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                  {['Model', 'Passed', 'Score', 'Spent', 'Latency', 'Tool calls', 'Tokens'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-normal whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={r.model} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 mono whitespace-nowrap">
                      {r.model} {i === 0 && results.length > 1 && <Tag tone="ok">best</Tag>}
                    </td>
                    <td className="px-3 py-2 mono">
                      {r.summary.passed}/{r.summary.tasks - r.summary.errors}
                      {r.summary.errors > 0 && <span className="text-muted-foreground" title="Model provider errors (quota, rate limit, overload), not scored"> · {r.summary.errors} err</span>}
                    </td>
                    <td className="px-3 py-2"><ScoreBar value={r.summary.meanScore} /></td>
                    <td className="px-3 py-2 mono">{usd(r.summary.totalSpentUsd)}</td>
                    <td className="px-3 py-2 mono">{r.summary.meanLatencyS.toFixed(1)} s</td>
                    <td className="px-3 py-2 mono">{r.summary.meanToolCalls.toFixed(1)}</td>
                    <td className="px-3 py-2 mono">{Math.round(r.summary.meanTokens).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {suite && <TaskMatrix tasks={suite.tasks} results={results} />}
        </>
      )}
    </div>
  )
}

function TaskMatrix({ tasks, results }: { tasks: NonNullable<AgentView['suite']>['tasks']; results: ModelResult[] }) {
  return (
    <div className="border border-border overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 text-left font-normal">Task</th>
            {results.map((r) => (
              <th key={r.model} className="px-3 py-2 text-left font-normal mono whitespace-nowrap">{r.model}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className="border-b border-border last:border-0 align-top">
              <td className="px-3 py-2">
                <div className="mono text-xs font-semibold">{t.id}{t.maxUsd === 0 && <span className="ml-1 text-muted-foreground font-normal">· free</span>}</div>
                <div className="text-xs text-muted-foreground max-w-xs">{t.goal}</div>
              </td>
              {results.map((r) => {
                const s = r.tasks.find((x) => x.taskId === t.id)
                if (!s) return <td key={r.model} className="px-3 py-2 text-muted-foreground">—</td>
                return (
                  <td key={r.model} className="px-3 py-2" title={s.status === 'error' ? 'Model provider error (not scored)' : s.failed.length ? `Failed: ${s.failed.join(', ')}` : 'All checks passed'}>
                    <span className={cn('mono text-xs font-semibold', s.status === 'pass' ? 'text-emerald-600' : s.status === 'fail' ? 'text-destructive' : 'text-muted-foreground')}>
                      {s.status.toUpperCase()}
                    </span>
                    {s.status !== 'error' && <span className="mono text-xs text-muted-foreground"> {pct(s.score)} · {usd(s.spentUsd)}</span>}
                    {s.status === 'fail' && s.failed.length > 0 && <div className="mt-0.5 text-[10px] text-muted-foreground">{s.failed.join(', ')}</div>}
                    {s.status === 'error' && <div className="mt-0.5 text-[10px] text-muted-foreground">provider quota / overload</div>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type SpendRow = { sequence: number; paymentUrl: string | null; message: { agent?: string; op: string; usd: number; decision: string; ts: string; reason?: string } }

function Activity({ label }: { label: string | null }) {
  const [rows, setRows] = useState<SpendRow[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!label) return
    const ctrl = new AbortController()
    fetch('/api/x402/v1/audit/recent?limit=100', { signal: ctrl.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { data?: { entries?: SpendRow[] } }) => {
        setRows((body.data?.entries ?? []).filter((e) => e.message?.agent === label).slice(0, 10))
      })
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') setError(true)
      })
    return () => ctrl.abort()
  }, [label])

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em]">Recent spend · HCS audit</h3>
      {!label ? (
        <Empty>Not provisioned · <code className="mono">npm run agents -- provision &lt;id&gt;</code></Empty>
      ) : error ? (
        <Empty>Audit feed unavailable</Empty>
      ) : rows === null ? (
        <Empty><Loader2 className="inline h-4 w-4 animate-spin" aria-label="Loading" /></Empty>
      ) : rows.length === 0 ? (
        <Empty>No spend records yet</Empty>
      ) : (
        <div className="border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r) => (
                <tr key={r.sequence} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 mono text-xs text-muted-foreground whitespace-nowrap">{new Date(r.message.ts).toLocaleString()}</td>
                  <td className="px-3 py-2 mono text-xs">{r.message.op}</td>
                  <td className="px-3 py-2">
                    <span className={cn('mono text-[10px] uppercase', r.message.decision === 'paid' ? 'text-emerald-600' : 'text-muted-foreground')}>{r.message.decision}</span>
                  </td>
                  <td className="px-3 py-2 mono text-xs">{usd(r.message.usd)}</td>
                  <td className="px-3 py-2 text-xs text-right">
                    {r.paymentUrl ? (
                      <a href={r.paymentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
                        tx <ArrowUpRight className="h-3 w-3" aria-hidden />
                      </a>
                    ) : (
                      <span className="text-muted-foreground" title={r.message.reason}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Balance({ accountId }: { accountId?: string }) {
  const [hbar, setHbar] = useState<number | null>(null)
  useEffect(() => {
    if (!accountId) return
    const ctrl = new AbortController()
    fetch(`${MIRROR_NODE_URL}/api/v1/accounts/${accountId}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { balance?: { balance?: number } } | null) => setHbar(b?.balance?.balance != null ? b.balance.balance / 1e8 : null))
      .catch(() => {})
    return () => ctrl.abort()
  }, [accountId])
  if (!accountId) return null
  return (
    <div className="border border-border px-3 py-2 text-right shrink-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Balance</div>
      <div className="mono font-semibold">{hbar === null ? '—' : `${hbar.toFixed(2)} HBAR`}</div>
    </div>
  )
}

function RunCommand({ id, example }: { id: string; example: string }) {
  const cmd = `npm run agents -- run ${id} --goal "${example}"`
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-2">
      <Label>Run</Label>
      <div className="flex items-stretch border border-border">
        <code className="flex-1 overflow-x-auto whitespace-nowrap px-3 py-2 mono text-xs">{cmd}</code>
        <button
          type="button"
          aria-label="Copy command"
          className="border-l border-border px-3 text-muted-foreground hover:text-foreground"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(cmd)
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            } catch {
              /* clipboard blocked */
            }
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  )
}

function IdCell({ label, id, kind }: { label: string; id?: string; kind: 'account' | 'topic' }) {
  return (
    <div className="border border-border px-3 py-2 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      {id ? (
        <a href={hashscan(kind, id)} target="_blank" rel="noopener noreferrer" className="mono text-sm inline-flex items-center gap-1 underline-offset-4 hover:underline">
          {id} <ArrowUpRight className="h-3 w-3" aria-hidden />
        </a>
      ) : (
        <div className="mono text-sm text-muted-foreground">—</div>
      )}
    </div>
  )
}

function ScoreBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 bg-muted" aria-hidden>
        <div className="h-full bg-foreground" style={{ width: pct(value) }} />
      </div>
      <span className="mono text-xs">{pct(value)}</span>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mono font-semibold mt-0.5">{value}</div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{children}</div>
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: 'ok' }) {
  return (
    <span className={cn('inline-block border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide', tone === 'ok' ? 'border-emerald-600/40 text-emerald-700' : 'border-border text-muted-foreground')}>
      {children}
    </span>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{children}</div>
}
