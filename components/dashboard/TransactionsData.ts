'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { forWallet, loadTransactions, type DashboardTx } from '@/lib/dashboard/history'
import { useHederaWallet } from '@/lib/hedera/wallet'

const STORAGE_KEY = 'finality.dashboard.transactions'

/** "$0.15", "0.15" or "0.15 USDC" → 0.15. Unparseable prices count as 0. */
export function parseUsd(price: string | number | undefined | null): number {
  if (typeof price === 'number') return Number.isFinite(price) ? price : 0
  const n = Number.parseFloat(String(price ?? '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : 0
}

export function formatUsd(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })
}

/** Settled + degraded calls were paid; rejected ones were not. */
export function isPaid(tx: DashboardTx) {
  return tx.status === 'settled' || tx.status === 'degraded'
}

export function walletSpend(txs: DashboardTx[]): number {
  return txs.filter(isPaid).reduce((sum, tx) => sum + parseUsd(tx.price), 0)
}

/** Remove only the given wallet's rows from local history, keeping other wallets' records. */
export function clearWalletTransactions(walletIds: string[]) {
  if (typeof window === 'undefined' || !walletIds.length) return
  const ids = new Set(walletIds.map((v) => v.toLowerCase()))
  const rest = loadTransactions().filter((tx) => !(tx.wallet && ids.has(tx.wallet.toLowerCase())))
  try {
    if (rest.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(rest))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event('finality:tx'))
}

/**
 * The connected wallet's local transaction history. Reads localStorage only after mount (no hydration mismatch),
 * re-reads on 'finality:tx' / cross-tab 'storage' events, and re-filters when the wallet changes.
 */
export function useWalletTransactions() {
  const { walletIds } = useHederaWallet()
  const idsKey = walletIds.join('|')
  const [all, setAll] = useState<DashboardTx[] | null>(null)

  useEffect(() => {
    const refresh = () => setAll(loadTransactions())
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === STORAGE_KEY) refresh()
    }
    refresh()
    window.addEventListener('finality:tx', refresh)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('finality:tx', refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const ids = useMemo(() => (idsKey ? idsKey.split('|') : []), [idsKey])
  const txs = useMemo(() => (all ? forWallet(all, ids) : []), [all, ids])
  const clear = useCallback(() => clearWalletTransactions(ids), [ids])

  return { txs, ready: all !== null, walletIds: ids, clear }
}
