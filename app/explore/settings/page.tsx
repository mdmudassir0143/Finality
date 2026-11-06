'use client'

import { useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import WalletButton from '@/components/WalletButton'
import { useWalletTransactions } from '@/components/dashboard/TransactionsData'
import { FACILITATOR } from '@/lib/facilitator'
import { merchantUrl } from '@/lib/x402/client'
import { useHederaWallet } from '@/lib/hedera/wallet'
import { HEDERA_NETWORK, USDC_TOKEN_ID } from '@/lib/hedera/config'

/**
 * Not wallet-gated: network and discovery info are public. Wallet-specific sections (account, local history)
 * render only once a wallet is connected.
 */
export default function SettingsPage() {
  const { connected, restoring, accountId, evmAddress, namespace, evmWallet, disconnect } = useHederaWallet()
  const { txs, ready, clear } = useWalletTransactions()
  const [disconnecting, setDisconnecting] = useState(false)

  const walletKind = namespace === 'hedera' ? 'HashPack' : evmWallet === 'magic' ? 'Magic' : evmWallet === 'metamask' ? 'MetaMask' : 'EVM'

  return (
    <div className="space-y-8 max-w-3xl">
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight uppercase">Settings</h1>

      <section className="border border-border p-5 space-y-4">
        <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Wallet</div>
        {restoring && !connected ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading wallet" />
        ) : connected ? (
          <>
            <div className="grid sm:grid-cols-3 gap-3">
              <InfoRow label="Wallet" value={walletKind} />
              <InfoRow label="Account" value={accountId || '—'} />
              <InfoRow label="EVM address" value={evmAddress || '—'} />
            </div>
            <Button
              variant="outline"
              className="rounded-none"
              disabled={disconnecting}
              onClick={async () => {
                setDisconnecting(true)
                try {
                  await disconnect()
                } finally {
                  setDisconnecting(false)
                }
              }}
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">Not connected</span>
            <WalletButton />
          </div>
        )}
      </section>

      <section className="border border-border p-5 space-y-4">
        <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Network</div>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <InfoRow label="Network" value={HEDERA_NETWORK.replace('-', ' ')} />
          <InfoRow label="USDC" value={USDC_TOKEN_ID} />
          <InfoRow label="Protocol" value="x402 exact · Hedera" />
          <InfoRow label="Facilitator" value="Blocky402" />
        </div>
      </section>

      <section className="border border-border p-5 space-y-3">
        <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Discovery</div>
        {[
          ['Catalog', `${merchantUrl}/v1/catalog`],
          ['OpenAPI', `${merchantUrl}/v1/openapi.json`],
          ['Health', `${merchantUrl}/health`],
          ['Info', `${merchantUrl}/info`],
          ['Facilitator', FACILITATOR.facilitator],
          ['Docs', FACILITATOR.docs],
        ].map(([label, href]) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between gap-3 text-sm border border-border px-3 py-2 hover:bg-muted/30"
          >
            <span>{label}</span>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground mono min-w-0 max-w-[60%]">
              <span className="truncate">{href}</span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </span>
          </a>
        ))}
      </section>

      {connected && (
        <section className="border border-border p-5 space-y-3">
          <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Local history</div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              {ready ? `${txs.length} ${txs.length === 1 ? 'record' : 'records'} for this wallet` : '…'}
            </span>
            <Button
              variant="outline"
              className="rounded-none"
              disabled={!ready || txs.length === 0}
              onClick={() => {
                if (window.confirm('Clear this wallet’s local transaction history?')) clear()
              }}
            >
              Clear history
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border p-3 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 mono text-xs break-all">{value}</div>
    </div>
  )
}
