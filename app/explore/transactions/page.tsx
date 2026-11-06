'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Filter, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { RequireWallet } from '@/components/dashboard/RequireWallet'
import { formatUsd, isPaid, parseUsd, useWalletTransactions, walletSpend } from '@/components/dashboard/TransactionsData'
import type { DashboardTx } from '@/lib/dashboard/history'
import { cn } from '@/lib/utils'

type StatusFilter = 'all' | 'settled' | 'rejected' | 'degraded'

export default function TransactionsPage() {
  return (
    <RequireWallet title="Transactions">
      <Transactions />
    </RequireWallet>
  )
}

function Transactions() {
  const { txs, ready, clear } = useWalletTransactions()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return txs.filter((tx) => {
      if (status !== 'all' && tx.status !== status) return false
      if (!q) return true
      const hay = `${tx.title} ${tx.operationId} ${tx.path} ${tx.id} ${tx.receipt || ''} ${tx.error || ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [txs, query, status])

  const spent = useMemo(() => walletSpend(txs), [txs])
  const paid = useMemo(() => txs.filter(isPaid).length, [txs])
  const filtering = query.trim() !== '' || status !== 'all'

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight uppercase">Transactions</h1>
          {ready && txs.length > 0 && (
            <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground mt-2">
              {paid} paid · {formatUsd(spent)} spent
            </div>
          )}
        </div>
        {txs.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="rounded-none h-9 text-[11px] uppercase"
            onClick={() => {
              if (window.confirm('Clear this wallet’s local transaction history?')) clear()
            }}
          >
            Clear history
          </Button>
        )}
      </div>

      {ready && txs.length === 0 ? (
        <div className="border border-dashed border-border p-10 grid place-items-center text-center gap-4">
          <div className="text-sm text-muted-foreground uppercase tracking-wide">No transactions for this wallet</div>
          <Button asChild variant="outline">
            <Link href="/explore/run">RUN_ENDPOINT</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search endpoint, receipt or ID"
                className="pl-9 h-10 rounded-none"
              />
            </div>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as StatusFilter)}
                aria-label="Status"
                className="h-10 w-full appearance-none border border-border bg-background pl-9 pr-8 text-sm outline-none min-w-[160px]"
              >
                <option value="all">All statuses</option>
                <option value="settled">Settled</option>
                <option value="degraded">Degraded</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>

          <div className="border border-border overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Status / Date</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Endpoint</th>
                  <th className="px-4 py-3 font-medium">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {!ready ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-16 text-center text-muted-foreground">
                      …
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-16 text-center text-muted-foreground">
                      No matches.{' '}
                      {filtering && (
                        <button
                          type="button"
                          className="underline underline-offset-4 hover:text-foreground"
                          onClick={() => {
                            setQuery('')
                            setStatus('all')
                          }}
                        >
                          Reset filters
                        </button>
                      )}
                    </td>
                  </tr>
                ) : (
                  filtered.map((tx) => <TxRow key={`${tx.id}-${tx.at}`} tx={tx} />)
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function TxRow({ tx }: { tx: DashboardTx }) {
  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/20">
      <td className="px-4 py-3 align-top whitespace-nowrap">
        <div className={cn('text-[10px] uppercase tracking-wider font-semibold', statusTone(tx.status))}>{tx.status}</div>
        <div className="text-xs text-muted-foreground mt-1">{new Date(tx.at).toLocaleString()}</div>
      </td>
      <td className={cn('px-4 py-3 align-top font-semibold whitespace-nowrap', !isPaid(tx) && 'text-muted-foreground line-through')}>
        {formatUsd(parseUsd(tx.price))}
      </td>
      <td className="px-4 py-3 align-top">
        <div className="font-medium">{tx.title}</div>
        <div className="text-xs text-muted-foreground mt-1">
          {tx.method} {tx.path}
        </div>
        {tx.status === 'rejected' && tx.error && (
          <div className="text-xs text-destructive mt-1 line-clamp-2 max-w-md" title={tx.error}>
            {tx.error}
          </div>
        )}
      </td>
      <td className="px-4 py-3 align-top">
        {tx.receipt ? <CopyButton value={tx.receipt} /> : <span className="text-xs text-muted-foreground">—</span>}
      </td>
    </tr>
  )
}

function CopyButton({ value }: { value: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<number | null>(null)

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current)
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setState('copied')
    } catch {
      setState('failed')
    }
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), 1500)
  }

  return (
    <Button variant="outline" size="sm" className="rounded-none h-8 text-[10px] uppercase min-w-[96px]" onClick={() => void copy()}>
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
    </Button>
  )
}

function statusTone(status: DashboardTx['status']) {
  if (status === 'settled') return 'text-foreground'
  if (status === 'degraded') return 'text-muted-foreground'
  return 'text-destructive'
}
