'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  AlertTriangle, Check, ChevronDown, Copy, ExternalLink, Hexagon, LogOut, Mail, RefreshCw, Repeat, Wallet, X, type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useHederaWallet, walletErrorMessage, type ConnectKind } from '@/lib/hedera/wallet'
import { FUSD } from '@/lib/x402/client'
import { readFusdBalance } from '@/lib/evm/fusd-client'
import { HEDERA_NETWORK } from '@/lib/hedera/config'

const short = (v: string) => (v.length > 14 ? `${v.slice(0, 6)}…${v.slice(-4)}` : v)
const hashscan = `https://hashscan.io/${HEDERA_NETWORK === 'hedera-mainnet' ? 'mainnet' : 'testnet'}`
const ERROR_TTL_MS = 6000
const focusRing = 'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background'

/**
 * One button with a chooser: HashPack (native Hedera, Reown AppKit), MetaMask (EIP-1193) and Magic (email wallet).
 * When connected it becomes an account menu: copy, HashScan, refresh balances, switch wallet, disconnect.
 * `align` positions the popover under the button: 'right' (header, default) or 'center' (centered cards).
 */
export default function WalletButton({ align = 'right' }: { align?: 'right' | 'center' }) {
  const {
    ready, restoring, accountId, evmAddress, namespace, evmWallet, magicAvailable, connecting, balances, wrongNetwork,
    connect, disconnect, switchWallet, switchToHederaNetwork, associateUsdc, refreshBalances,
  } = useHederaWallet()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fusdBalance, setFusdBalance] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const alive = useRef(true)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      clearTimeout(copyTimer.current)
    }
  }, [])

  const loadFusd = useCallback(async () => {
    if (namespace !== 'eip155' || !evmAddress || !FUSD) return setFusdBalance(null)
    try {
      const value = Number(await readFusdBalance(FUSD, evmAddress as `0x${string}`)).toFixed(2)
      if (alive.current) setFusdBalance(value)
    } catch {
      if (alive.current) setFusdBalance(null)
    }
  }, [namespace, evmAddress])

  // Balances go stale after a payment: refresh them (cheap Mirror Node call) whenever the account menu opens.
  useEffect(() => {
    if (!open || !namespace) return
    void refreshBalances()
    void loadFusd()
  }, [open, namespace, refreshBalances, loadFusd])

  // Errors dismiss themselves; the × button dismisses them sooner.
  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), ERROR_TTL_MS)
    return () => clearTimeout(t)
  }, [error])

  // Close on outside click or Escape (focus returns to the trigger); focus the first item when opened.
  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus({ preventScroll: true })
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, namespace])

  /** Arrow keys / Home / End move between menu items. */
  const onPanelKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])
    if (!items.length) return
    e.preventDefault()
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
      : e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
    items[next]?.focus()
  }

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
    } catch (e) {
      console.error('[finality-wallet]', label, e)
      if (alive.current) setError(walletErrorMessage(e))
    } finally {
      if (alive.current) setBusy(null)
    }
  }

  const panelPos = align === 'center' ? 'left-1/2 -translate-x-1/2' : 'right-0'
  const panelBase = `absolute top-full ${panelPos} mt-2 max-w-[calc(100vw-2rem)] border border-border bg-background shadow-lg z-50 text-sm`

  const errorBox = error && (
    <div role="alert" className="flex items-start gap-2 text-[11px] text-destructive">
      <span className="flex-1 break-words">{error}</span>
      <button type="button" aria-label="Dismiss" onClick={() => setError(null)} className={`shrink-0 -m-0.5 p-0.5 hover:text-foreground ${focusRing}`}>
        <X className="h-3 w-3" />
      </button>
    </div>
  )

  if (!namespace) {
    const loading = !ready && restoring
    const disabled = loading || connecting || busy !== null
    const pick = (label: string, kind: ConnectKind) => {
      setOpen(false)
      return run(label, () => connect(kind))
    }
    return (
      <div className="relative" ref={rootRef}>
        <Button
          ref={triggerRef}
          onClick={() => setOpen((v) => !v)}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          className="h-9"
        >
          {loading ? 'Loading…' : connecting || busy ? 'Connecting…' : 'Connect wallet'}
        </Button>
        {open && (
          <div ref={panelRef} role="menu" aria-label="Choose a wallet" onKeyDown={onPanelKey} className={`${panelBase} w-64 p-1.5 space-y-1`}>
            <ChooserItem icon={Hexagon} title="HashPack" tag="HBAR · USDC" onClick={() => pick('connect', 'hedera')} />
            <ChooserItem icon={Wallet} title="MetaMask" tag="fUSD" onClick={() => pick('connect-evm', 'eip155')} />
            {magicAvailable && <ChooserItem icon={Mail} title="Email" tag="fUSD" onClick={() => pick('connect-magic', 'magic')} />}
          </div>
        )}
        {!open && error && <div className={`${panelBase} w-64 p-2.5`}>{errorBox}</div>}
      </div>
    )
  }

  const walletName = namespace === 'hedera' ? 'HashPack' : evmWallet === 'magic' ? 'Email' : 'MetaMask'
  const primary = accountId ?? (evmAddress ? short(evmAddress) : '—')
  const copyValue = accountId ?? evmAddress ?? ''
  const isEvm = namespace === 'eip155'
  const dot = wrongNetwork ? 'bg-amber-500' : isEvm ? 'bg-sky-500' : 'bg-emerald-500'

  return (
    <div className="relative" ref={rootRef}>
      <Button
        ref={triggerRef}
        variant="outline"
        size="sm"
        className="gap-2 h-9 max-w-[calc(100vw-2rem)]"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${walletName} ${copyValue}${wrongNetwork ? ', wrong network' : ''}`}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <span className="mono text-xs truncate">{primary}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </Button>

      {open && (
        <div ref={panelRef} role="menu" aria-label="Wallet" onKeyDown={onPanelKey} className={`${panelBase} w-72`}>
          <div className="p-3 space-y-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
              <span className="mono text-xs truncate" title={copyValue}>{primary}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">{walletName}</span>
              <div className="ml-auto flex shrink-0 items-center">
                <IconButton
                  icon={copied ? Check : Copy}
                  label="Copy address"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(copyValue)
                    } catch {
                      return setError('Copy failed')
                    }
                    setCopied(true)
                    clearTimeout(copyTimer.current)
                    copyTimer.current = setTimeout(() => setCopied(false), 1200)
                  }}
                />
                <IconButton
                  icon={ExternalLink}
                  label="View on HashScan"
                  onClick={() => void window.open(`${hashscan}/account/${copyValue}`, '_blank', 'noopener,noreferrer')}
                />
                <IconButton
                  icon={RefreshCw}
                  label="Refresh balances"
                  spin={busy === 'refresh'}
                  onClick={() => run('refresh', async () => {
                    await Promise.all([refreshBalances(), loadFusd()])
                  })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Stat label="HBAR" value={balances ? balances.hbar.toFixed(2) : '—'} />
              {isEvm ? (
                <Stat label="fUSD" value={fusdBalance ?? '—'} />
              ) : (
                <Stat label="USDC" value={balances ? balances.usdc.toFixed(2) : '—'} />
              )}
            </div>

            {wrongNetwork && (
              <div className="flex items-center gap-2 text-[11px] text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Wrong network
              </div>
            )}

            {namespace === 'hedera' && balances && !balances.associated && (
              <Button
                variant="outline"
                size="sm"
                className="w-full h-8 rounded-none text-xs"
                disabled={busy !== null}
                onClick={() => void run('associate', associateUsdc)}
              >
                {busy === 'associate' ? 'Associating…' : 'Associate USDC'}
              </Button>
            )}
            {errorBox}
          </div>

          <div className="border-t border-border p-1">
            {wrongNetwork && (
              <MenuItem
                icon={RefreshCw}
                label={busy === 'network' ? 'Switching…' : 'Switch to Hedera'}
                disabled={busy !== null}
                onClick={() => run('network', switchToHederaNetwork)}
              />
            )}
            <MenuItem
              icon={Repeat}
              label={busy === 'switch' ? 'Switching…' : 'Switch wallet'}
              disabled={busy !== null}
              onClick={() =>
                // Disconnect only, then show the wallet chooser again.
                run('switch', async () => {
                  await switchWallet()
                  if (alive.current) setOpen(true)
                })
              }
            />
            <MenuItem
              icon={LogOut}
              label={busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
              danger
              disabled={busy !== null}
              onClick={() => {
                setOpen(false)
                return run('disconnect', disconnect)
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border px-2.5 py-2 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mono font-semibold mt-0.5 truncate">{value}</div>
    </div>
  )
}

function IconButton({ icon: Icon, label, onClick, spin }: { icon: LucideIcon; label: string; onClick: () => void | Promise<void>; spin?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => void onClick()}
      className={`h-7 w-7 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 ${focusRing}`}
    >
      <Icon className={`h-3.5 w-3.5 ${spin ? 'animate-spin' : ''}`} />
    </button>
  )
}

function MenuItem({ icon: Icon, label, onClick, danger, disabled }: {
  icon: LucideIcon; label: string; onClick: () => void | Promise<void>; danger?: boolean; disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => void onClick()}
      className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 focus-visible:bg-muted/40 disabled:opacity-50 disabled:pointer-events-none ${focusRing} ${danger ? 'text-destructive' : ''}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </button>
  )
}

function ChooserItem({ icon: Icon, title, tag, onClick }: { icon: LucideIcon; title: string; tag: string; onClick: () => void | Promise<void> }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => void onClick()}
      className={`w-full flex items-center gap-3 px-2.5 py-2.5 border border-transparent hover:border-border hover:bg-muted/30 focus-visible:border-border focus-visible:bg-muted/30 text-left ${focusRing}`}
    >
      <span className="h-8 w-8 shrink-0 inline-flex items-center justify-center border border-border" aria-hidden>
        <Icon className="h-4 w-4" />
      </span>
      <span className="font-semibold">{title}</span>
      <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground mono">{tag}</span>
    </button>
  )
}
