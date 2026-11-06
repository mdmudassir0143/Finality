'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Activity, ArrowRight, DollarSign, Link2, Plus, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RequireWallet } from '@/components/dashboard/RequireWallet'
import { formatUsd, isPaid, parseUsd, useWalletTransactions, walletSpend } from '@/components/dashboard/TransactionsData'
import { fetchCatalog, fetchHealth, metaFor, type CatalogEndpoint } from '@/lib/dashboard/catalog'
import type { DashboardTx } from '@/lib/dashboard/history'
import { cn } from '@/lib/utils'

export default function OverviewPage() {
  return (
    <RequireWallet title="Overview">
      <Overview />
    </RequireWallet>
  )
}

function Overview() {
  const { txs, ready } = useWalletTransactions()
  const [catalog, setCatalog] = useState<CatalogEndpoint[]>([])
  const [health, setHealth] = useState<Record<string, any> | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const [c, h] = await Promise.all([fetchCatalog(), fetchHealth().catch(() => null)])
        if (!live) return
        setCatalog(c)
        setHealth(h)
        setError('')
      } catch (e: any) {
        if (live) setError(e?.message || 'Merchant unavailable')
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => {
      live = false
    }
  }, [])

  const spent = useMemo(() => walletSpend(txs), [txs])
  const paidCalls = useMemo(() => txs.filter(isPaid).length, [txs])
  const categories = useMemo(() => new Set(catalog.map((item) => metaFor(item.operationId).category)).size, [catalog])

  const status = loading ? '…' : error ? 'offline' : String(health?.status || 'unknown')
  const facilitator = health?.components?.x402?.facilitator
  const recent = txs.slice(0, 5)

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight uppercase">Overview</h1>
        <Button asChild>
          <Link href="/explore/run">
            <Plus className="h-4 w-4" />
            RUN_ENDPOINT
          </Link>
        </Button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="SPEND" value={ready ? formatUsd(spent) : '…'} hint="This wallet" icon={<DollarSign className="h-4 w-4" />} />
        <StatCard
          label="PAID_CALLS"
          value={ready ? String(paidCalls) : '…'}
          hint={ready ? `${txs.length - paidCalls} rejected` : ''}
          icon={<Activity className="h-4 w-4" />}
        />
        <StatCard
          label="ENDPOINTS"
          value={loading ? '…' : error ? '—' : String(catalog.length)}
          hint={loading || error ? '' : `${categories} categories`}
          icon={<Link2 className="h-4 w-4" />}
        />
        <StatCard
          label="MERCHANT"
          value={status.toUpperCase()}
          hint={facilitator ? String(facilitator) : ''}
          icon={<Server className="h-4 w-4" />}
          tone={error ? 'text-destructive' : undefined}
        />
      </div>

      {error && <div className="border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Recent_Activity</div>
          {txs.length > 0 && (
            <Link
              href="/explore/transactions"
              className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>
        {!ready ? (
          <div className="border border-border p-10 text-center text-sm text-muted-foreground">…</div>
        ) : recent.length === 0 ? (
          <div className="border border-dashed border-border p-10 grid place-items-center text-center gap-4">
            <div className="text-sm text-muted-foreground uppercase tracking-wide">No calls from this wallet yet</div>
            <Button asChild variant="outline">
              <Link href="/explore/run">RUN_ENDPOINT</Link>
            </Button>
          </div>
        ) : (
          <div className="border border-border divide-y divide-border">
            {recent.map((tx) => (
              <RecentRow key={`${tx.id}-${tx.at}`} tx={tx} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function RecentRow({ tx }: { tx: DashboardTx }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
      <div className="min-w-0">
        <div className="font-semibold truncate">{tx.title}</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {tx.method} · {tx.operationId} · {new Date(tx.at).toLocaleString()}
        </div>
      </div>
      <div className="text-right">
        <div className={cn('font-semibold', !isPaid(tx) && 'text-muted-foreground line-through')}>
          {formatUsd(parseUsd(tx.price))}
        </div>
        <div
          className={cn(
            'text-[10px] uppercase tracking-wider mt-0.5',
            tx.status === 'rejected' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {tx.status}
        </div>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string
  value: string
  hint: string
  icon: React.ReactNode
  tone?: string
}) {
  return (
    <div className="border border-border p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
        <div className="text-muted-foreground">{icon}</div>
      </div>
      <div className={cn('text-3xl font-bold tracking-tight mt-4 truncate', tone)}>{value}</div>
      <div className="text-xs text-muted-foreground mt-2 min-h-4 truncate">{hint}</div>
    </div>
  )
}
