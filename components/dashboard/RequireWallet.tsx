'use client'

import { Loader2, Lock } from 'lucide-react'
import WalletButton from '@/components/WalletButton'
import { useHederaWallet } from '@/lib/hedera/wallet'

/**
 * Gate for wallet-scoped dashboard pages (overview, transactions, audit). While a previous session restores it shows
 * a spinner (no flash of the locked state); when no wallet is connected it shows a single Connect action.
 */
export function RequireWallet({ title, children }: { title: string; children: React.ReactNode }) {
  const { connected, restoring } = useHederaWallet()

  if (connected) return <>{children}</>

  if (restoring) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center text-muted-foreground" role="status" aria-live="polite">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        <span className="sr-only">Loading wallet</span>
      </div>
    )
  }

  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="w-full max-w-sm border border-border p-8 text-center space-y-5">
        <div className="mx-auto h-10 w-10 border border-border inline-flex items-center justify-center" aria-hidden>
          <Lock className="h-4 w-4" />
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-bold uppercase tracking-tight">{title}</h1>
          <p className="text-xs text-muted-foreground">Connect a wallet to continue.</p>
        </div>
        <div className="flex justify-center">
          <WalletButton align="center" />
        </div>
      </div>
    </div>
  )
}
