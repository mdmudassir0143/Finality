'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { merchantUrl } from '@/lib/x402/client'
import { useHederaWallet } from '@/lib/hedera/wallet'
import { HEDERA_NETWORK } from '@/lib/hedera/config'
import { erc8004Config, publicClientFor, reputationRegistryAbi } from '@/lib/evm/erc8004'

type MerchantIdentity = {
  registered: boolean
  agentId?: string
  agentRegistry?: string
  owner?: string
  ownerUrl?: string
  registration?: { name?: string; services?: Array<{ name: string; endpoint: string }> } | null
  reputation?: { clients: number; count: number; average: number | null }
}

type RateStatus =
  | { kind: 'idle' }
  | { kind: 'pending'; text: string }
  | { kind: 'done'; hash: string }
  | { kind: 'error'; text: string }

const slug = HEDERA_NETWORK === 'hedera-mainnet' ? 'mainnet' : 'testnet'
const chainId = HEDERA_NETWORK === 'hedera-mainnet' ? 295 : 296

async function getJson(url: string) {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

/** Finality's ERC-8004 identity on Hedera EVM, with on-chain rating from a connected EVM wallet. */
export default function Erc8004Panel() {
  const { namespace, evmAddress, getEvmWalletClient } = useHederaWallet()
  const [identity, setIdentity] = useState<MerchantIdentity | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [reputationRegistry, setReputationRegistry] = useState<`0x${string}` | null>(null)
  const [status, setStatus] = useState<RateStatus>({ kind: 'idle' })
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const load = useCallback(async () => {
    // Independent requests: a missing /.well-known/x402 must not hide the identity itself.
    const [merchant, wellKnown] = await Promise.allSettled([
      getJson(`${merchantUrl}/v1/erc8004/merchant`),
      getJson(`${merchantUrl}/.well-known/x402`),
    ])
    if (!mounted.current) return
    if (merchant.status === 'fulfilled') setIdentity(merchant.value?.data ?? null)
    if (wellKnown.status === 'fulfilled') setReputationRegistry(wellKnown.value?.identity?.reputationRegistry ?? null)
    setLoaded(true)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const busy = status.kind === 'pending'
  const isOwner = Boolean(evmAddress && identity?.owner && evmAddress.toLowerCase() === identity.owner.toLowerCase())

  const rate = async (score: number) => {
    const wallet = getEvmWalletClient()
    if (!wallet?.account) {
      setStatus({ kind: 'error', text: 'EVM wallet not ready. Reconnect and try again.' })
      return
    }
    if (!identity?.agentId || !reputationRegistry) {
      setStatus({ kind: 'error', text: 'Reputation registry unavailable.' })
      return
    }
    setStatus({ kind: 'pending', text: 'Confirm in your wallet…' })
    try {
      const hash = await wallet.writeContract({
        account: wallet.account,
        chain: wallet.chain,
        address: reputationRegistry,
        abi: reputationRegistryAbi,
        functionName: 'giveFeedback',
        args: [BigInt(identity.agentId), BigInt(score), 0, 'x402', 'web-ui', window.location.origin, '', `0x${'0'.repeat(64)}`],
      })
      if (mounted.current) setStatus({ kind: 'pending', text: 'Confirming on Hedera EVM…' })
      const evm = erc8004Config(HEDERA_NETWORK)
      if (evm) await publicClientFor(evm).waitForTransactionReceipt({ hash })
      if (!mounted.current) return
      setStatus({ kind: 'done', hash })
      await load()
    } catch (error) {
      if (mounted.current) {
        setStatus({ kind: 'error', text: `Feedback failed: ${String((error as Error)?.message ?? error).split('\n')[0]}` })
      }
    }
  }

  if (!loaded) {
    return (
      <div className="border border-border p-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> ERC-8004 identity
      </div>
    )
  }
  if (!identity) return null
  if (!identity.registered) {
    return <div className="border border-border px-4 py-4 text-sm text-muted-foreground">No ERC-8004 identity registered.</div>
  }

  const rep = identity.reputation
  return (
    <div className="border border-border p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">ERC-8004 · Hedera EVM</div>
          <div className="text-lg font-bold mt-1">
            {identity.registration?.name ?? 'Finality'}{' '}
            <span className="mono text-sm text-muted-foreground">#{identity.agentId}</span>
          </div>
          <div className="text-xs text-muted-foreground mono mt-1 break-all">{identity.agentRegistry}</div>
          {identity.ownerUrl && (
            <a
              href={identity.ownerUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs underline underline-offset-4 inline-flex items-center gap-1 mt-1"
            >
              Owner {identity.owner?.slice(0, 6)}…{identity.owner?.slice(-4)} <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Reputation</div>
          <div className="text-2xl font-bold">{rep?.average != null ? `${Math.round(rep.average)}/100` : '—'}</div>
          <div className="text-xs text-muted-foreground">
            {rep?.count ?? 0} {rep?.count === 1 ? 'review' : 'reviews'} · {rep?.clients ?? 0}{' '}
            {rep?.clients === 1 ? 'client' : 'clients'}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs border-t border-border pt-3">
        {namespace === 'eip155' && !isOwner && (
          <>
            <span className="text-muted-foreground uppercase tracking-[0.14em] text-[10px] mr-1">Rate</span>
            <Button
              size="sm"
              variant="outline"
              className="rounded-none h-8"
              disabled={busy || !reputationRegistry}
              onClick={() => void rate(100)}
            >
              Good (100)
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-none h-8"
              disabled={busy || !reputationRegistry}
              onClick={() => void rate(20)}
            >
              Poor (20)
            </Button>
          </>
        )}
        {namespace === 'eip155' && isOwner && <span className="text-muted-foreground">Owners can’t rate their own agent.</span>}
        {namespace !== 'eip155' && <span className="text-muted-foreground">Connect an EVM wallet (chain {chainId}) to rate.</span>}
      </div>

      {status.kind === 'pending' && (
        <div className="text-xs text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {status.text}
        </div>
      )}
      {status.kind === 'done' && (
        <a
          href={`https://hashscan.io/${slug}/transaction/${status.hash}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs underline underline-offset-4 inline-flex items-center gap-1"
        >
          Feedback recorded <ExternalLink className="h-3 w-3" />
        </a>
      )}
      {status.kind === 'error' && <div className="text-xs text-destructive break-all">{status.text}</div>}
    </div>
  )
}
