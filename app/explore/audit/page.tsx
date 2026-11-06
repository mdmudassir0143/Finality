'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RequireWallet } from '@/components/dashboard/RequireWallet'
import Erc8004Panel from '@/components/Erc8004Panel'
import { merchantUrl } from '@/lib/x402/client'
import { HBAR_ASSET_ID } from '@/lib/hedera/config'
import { useHederaWallet } from '@/lib/hedera/wallet'
import { cn } from '@/lib/utils'

type SaleMessage = {
  type: 'sale'
  op: string
  method: string
  path: string
  payer: string
  payTo: string
  asset: string
  amount: string
  tx: string
  sha256: string
  ts: string
}

type SpendMessage = {
  type: 'spend'
  agent: string
  op: string
  merchant: string
  payTo: string
  asset: string
  amount: string
  usd: number
  tx?: string
  decision: 'paid' | 'skipped' | 'denied' | 'failed'
  reason?: string
  budgetLeftUsd: number
  ts: string
}

type AuditEntry = {
  sequence: number
  consensusTimestamp: string
  hcsUrl: string
  paymentUrl: string | null
  message: SaleMessage | SpendMessage
}

type AuditFeed = {
  enabled: boolean
  network: string
  topicId: string | null
  topicUrl?: string
  entries: AuditEntry[]
  ignored?: number
}

type Scope = 'mine' | 'all'

const REFRESH_MS = 15_000

function formatAmount(asset: string, amount: string): string {
  const n = Number(amount)
  if (!Number.isFinite(n)) return amount
  if (asset === HBAR_ASSET_ID) return `${(n / 1e8).toLocaleString('en', { maximumFractionDigits: 8 })} HBAR`
  // EVM settlements are in fUSD (ERC-20, 6 decimals); native Hedera token settlements are USDC (6 decimals).
  const unit = asset.startsWith('0x') ? 'fUSD' : 'USDC'
  return `${(n / 1e6).toLocaleString('en', { maximumFractionDigits: 6 })} ${unit}`
}

function consensusTime(ts: string): string {
  const seconds = Number.parseFloat(ts)
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toLocaleString() : ts
}

function short(id: string | undefined | null): string {
  if (!id) return '—'
  return id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id
}

export default function AuditPage() {
  return (
    <RequireWallet title="Audit trail">
      <Audit />
    </RequireWallet>
  )
}

function Audit() {
  const { walletIds } = useHederaWallet()
  const idsKey = walletIds.join('|')
  const [feed, setFeed] = useState<AuditFeed | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [scope, setScope] = useState<Scope>('mine')
  const inFlight = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    // Never let a slow response overwrite a newer one: abort the previous request first.
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    setLoading(true)
    try {
      const response = await fetch(`${merchantUrl}/v1/audit/recent?limit=50`, { cache: 'no-store', signal: controller.signal })
      const body = (await response.json().catch(() => ({}))) as {
        success?: boolean
        data?: AuditFeed
        error?: { message?: string }
      }
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? `HTTP ${response.status}`)
      if (controller.signal.aborted) return
      setFeed(body.data)
      setError(null)
    } catch (err) {
      if (controller.signal.aborted) return
      setError(err instanceof Error ? err.message : 'Audit feed unavailable')
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void load()
    // Poll only while the tab is visible; refresh immediately when it becomes visible again.
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, REFRESH_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      inFlight.current?.abort()
    }
  }, [load])

  const mine = useMemo(() => {
    const ids = new Set(idsKey ? idsKey.split('|') : [])
    return (feed?.entries ?? []).filter((e) => e.message.type === 'sale' && ids.has((e.message.payer || '').toLowerCase()))
  }, [feed, idsKey])

  const entries = scope === 'mine' ? mine : (feed?.entries ?? [])
  const sales = entries.filter((e) => e.message.type === 'sale').length
  const spends = entries.length - sales

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight uppercase">Audit trail</h1>
        <Button
          variant="outline"
          size="sm"
          className="rounded-none h-9 text-[11px] uppercase"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={cn('h-3.5 w-3.5 mr-2', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <Erc8004Panel />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Network" value={feed?.network ?? '—'} />
        <Stat
          label="HCS topic"
          value={
            feed?.topicId && feed.topicUrl ? (
              <a
                href={feed.topicUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline underline-offset-4"
              >
                {feed.topicId}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : feed ? (
              'Not configured'
            ) : (
              '—'
            )
          }
        />
        <Stat label="Sales" value={feed ? String(sales) : '—'} />
        <Stat label="Agent spends" value={feed ? String(spends) : '—'} />
      </div>

      {error && (
        <div className="border border-destructive/40 text-destructive text-sm px-4 py-3 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button type="button" className="underline underline-offset-4 text-xs uppercase" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {feed && !feed.enabled && (
        <div className="border border-border px-4 py-6 text-sm text-muted-foreground">
          Audit trail is off on this merchant (set <code>HCS_AUDIT_TOPIC_ID</code>).
        </div>
      )}

      {!feed && !error && (
        <div className="border border-border px-4 py-16 text-center text-sm text-muted-foreground">Loading audit feed…</div>
      )}

      {feed?.enabled && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Records</div>
            <div className="inline-flex border border-border" role="group" aria-label="Scope">
              {(['mine', 'all'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={scope === s}
                  onClick={() => setScope(s)}
                  className={cn(
                    'px-3 h-8 text-[10px] uppercase tracking-[0.14em] border-border first:border-r',
                    scope === s ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {s === 'mine' ? `Mine (${mine.length})` : `All (${feed.entries.length})`}
                </button>
              ))}
            </div>
          </div>

          <div className="border border-border overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[860px]">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="px-4 py-3 font-medium"># / Consensus time</th>
                  <th className="px-4 py-3 font-medium">Event</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Parties</th>
                  <th className="px-4 py-3 font-medium">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-16 text-center text-muted-foreground">
                      {scope === 'mine' && feed.entries.length > 0 ? (
                        <>
                          No records for this wallet.{' '}
                          <button
                            type="button"
                            className="underline underline-offset-4 hover:text-foreground"
                            onClick={() => setScope('all')}
                          >
                            Show all
                          </button>
                        </>
                      ) : (
                        'No audit records yet.'
                      )}
                    </td>
                  </tr>
                ) : (
                  entries.map((entry) => <AuditRow key={entry.sequence} entry={entry} />)
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const m = entry.message
  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/20 align-top">
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="font-semibold mono text-xs">#{entry.sequence}</div>
        <div className="text-xs text-muted-foreground mt-1">{consensusTime(entry.consensusTimestamp)}</div>
      </td>
      <td className="px-4 py-3">
        <div className="text-[10px] uppercase tracking-wider font-semibold">
          {m.type === 'sale' ? 'Sale' : `Agent spend · ${m.decision}`}
        </div>
        <div className="font-medium mt-1">{m.op}</div>
        {m.type === 'sale' ? (
          <div className="text-xs text-muted-foreground mt-1 mono" title={m.sha256}>
            sha256 {m.sha256?.slice(0, 12)}…
          </div>
        ) : (
          m.reason && <div className="text-xs text-muted-foreground mt-1">{m.reason}</div>
        )}
      </td>
      <td className="px-4 py-3 font-semibold whitespace-nowrap">
        {formatAmount(m.asset, m.amount)}
        {m.type === 'spend' && Number.isFinite(m.budgetLeftUsd) && (
          <div className="text-xs text-muted-foreground font-normal mt-1">budget left ${m.budgetLeftUsd.toFixed(2)}</div>
        )}
      </td>
      <td className="px-4 py-3 text-xs mono">
        {m.type === 'sale' ? (
          <div title={m.payer} className="break-all">payer {short(m.payer)}</div>
        ) : (
          <div className="break-all max-w-[220px]" title={m.agent}>
            agent {m.agent?.includes('#') ? `#${m.agent.split('#').pop()}` : short(m.agent)}
          </div>
        )}
        <div className="text-muted-foreground mt-1" title={m.payTo}>
          payTo {short(m.payTo)}
        </div>
      </td>
      <td className="px-4 py-3 text-xs space-y-1">
        <a href={entry.hcsUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 underline underline-offset-4">
          HCS record <ExternalLink className="h-3 w-3" />
        </a>
        {entry.paymentUrl && (
          <a
            href={entry.paymentUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 underline underline-offset-4"
          >
            Payment tx <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </td>
    </tr>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border border-border px-4 py-3 min-w-0">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold mt-1 truncate">{value}</div>
    </div>
  )
}
