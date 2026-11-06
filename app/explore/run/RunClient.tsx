'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Loader2, RotateCcw, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import WalletButton from '@/components/WalletButton'
import {
  callPaidResource,
  callPaidResourceWithEvm,
  FUSD,
  isUserRejection,
  merchantUrl,
  paymentErrorMessage,
  type PaymentAsset,
  type PaymentState,
} from '@/lib/x402/client'
import { evmSignerFromWallet, readFusdBalance } from '@/lib/evm/fusd-client'
import { createHashPackHederaSigner } from '@/lib/hedera/signer'
import { useHederaWallet } from '@/lib/hedera/wallet'
import { fetchCatalog, metaFor, isProEndpoint, priceValue, type CatalogEndpoint } from '@/lib/dashboard/catalog'
import { saveTransaction } from '@/lib/dashboard/history'
import ResultPresentation, { sampleResultFor, type ResultEnvelope } from '@/components/ResultPresentation'
import { cn } from '@/lib/utils'

type HederaAsset = Exclude<PaymentAsset, 'fUSD'>
type ParsedInput = { ok: true; value: Record<string, unknown> } | { ok: false; error: string }

const BUSY_STATES: PaymentState[] = ['requesting', 'signing', 'settling']

/** Parse the request box. GET inputs must be flat (primitives or arrays of primitives) to become a query string. */
function parseInput(raw: string, method: CatalogEndpoint['method']): ParsedInput {
  if (!raw.trim()) return { ok: true, value: {} }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}` }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'Input must be a JSON object, e.g. {}' }
  if (method === 'GET') {
    const isPrimitive = (v: unknown) => v == null || ['string', 'number', 'boolean'].includes(typeof v)
    for (const [k, v] of Object.entries(value)) {
      if (Array.isArray(v) ? !v.every(isPrimitive) : !isPrimitive(v)) {
        return { ok: false, error: `"${k}": nested objects cannot be sent as a GET query` }
      }
    }
  }
  return { ok: true, value: value as Record<string, unknown> }
}

function buildQuery(value: Record<string, unknown>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(value)) {
    if (v == null) continue
    if (Array.isArray(v)) v.filter((x) => x != null).forEach((x) => qs.append(k, String(x)))
    else qs.set(k, String(v))
  }
  const s = qs.toString()
  return s ? `?${s}` : ''
}

const exampleInput = (e: CatalogEndpoint) => JSON.stringify(e.requestExample ?? {}, null, 2)

export default function RunClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const opParam = searchParams.get('op')
  const { connected, restoring, accountId, evmAddress, namespace, evmWallet, canPayX402, balances, getDappSigner, getEvmWalletClient } = useHederaWallet()

  // HashPack pays USDC/HBAR on Hedera natively; MetaMask/Magic (eip155) pay fUSD on Hedera EVM.
  const isEvm = namespace === 'eip155'
  const canPayEvm = isEvm && Boolean(FUSD)
  const canPay = canPayX402 || canPayEvm
  const walletName = namespace === 'hedera' ? 'HashPack' : evmWallet === 'magic' ? 'Email' : evmWallet === 'metamask' ? 'MetaMask' : null
  const walletLabel = isEvm ? evmAddress ?? accountId : accountId ?? evmAddress
  const walletKey = namespace ? `${namespace}:${(isEvm ? evmAddress : accountId) ?? ''}` : ''

  const [catalog, setCatalog] = useState<CatalogEndpoint[]>([])
  const [loading, setLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [input, setInput] = useState('{}')
  const [hederaAsset, setHederaAsset] = useState<HederaAsset>('USDC')
  const [result, setResult] = useState<ResultEnvelope | null>(null)
  const [receipt, setReceipt] = useState<string | null>(null)
  const [state, setState] = useState<PaymentState>('idle')
  const [error, setError] = useState('')
  const [showExample, setShowExample] = useState(false)
  const [fusdBalance, setFusdBalance] = useState<string | null>(null)
  const inFlight = useRef(false)
  const runId = useRef(0)

  const asset: PaymentAsset = isEvm ? 'fUSD' : hederaAsset

  const loadCatalog = useCallback(async () => {
    setLoading(true)
    setCatalogError('')
    try {
      setCatalog(await fetchCatalog())
    } catch (e) {
      setCatalogError(e instanceof Error ? e.message : 'Catalog unavailable')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  // The URL (?op=) is the source of truth for the selected endpoint, so deep links and back/forward work.
  const endpoint = useMemo(
    () => catalog.find((v) => v.operationId === opParam) ?? catalog[0],
    [catalog, opParam],
  )
  const meta = endpoint ? metaFor(endpoint.operationId) : null
  const example = useMemo(() => (endpoint ? sampleResultFor(endpoint.operationId) : null), [endpoint])
  const parsed = useMemo(() => (endpoint ? parseInput(input, endpoint.method) : null), [input, endpoint])

  const resetRun = useCallback(() => {
    runId.current += 1
    inFlight.current = false
    setResult(null)
    setReceipt(null)
    setError('')
    setState('idle')
    setShowExample(false)
  }, [])

  // New endpoint: load its example input and drop the previous run (an in-flight run is ignored by runId).
  const endpointId = endpoint?.operationId
  useEffect(() => {
    if (!endpoint) return
    setInput(exampleInput(endpoint))
    resetRun()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpointId, resetRun])

  // Wallet switched or disconnected: the previous run belongs to another payer.
  const lastWallet = useRef(walletKey)
  useEffect(() => {
    if (lastWallet.current === walletKey) return
    lastWallet.current = walletKey
    resetRun()
  }, [walletKey, resetRun])

  const refreshFusd = useCallback(async () => {
    if (!isEvm || !FUSD || !evmAddress) return setFusdBalance(null)
    try {
      setFusdBalance(Number(await readFusdBalance(FUSD, evmAddress as `0x${string}`)).toFixed(2))
    } catch {
      setFusdBalance(null)
    }
  }, [isEvm, evmAddress])

  useEffect(() => {
    void refreshFusd()
  }, [refreshFusd])

  const selectEndpoint = (operationId: string) => {
    router.replace(`/explore/run?op=${encodeURIComponent(operationId)}`, { scroll: false })
  }

  const busy = BUSY_STATES.includes(state)
  const price = endpoint ? priceValue(endpoint.price) : Number.NaN
  // Balance of the asset that will be paid: fUSD (EVM) or the chosen HashPack asset.
  const balance: string | null = !connected
    ? null
    : isEvm
      ? fusdBalance
      : !balances
        ? null
        : hederaAsset === 'HBAR'
          ? balances.hbar.toFixed(2)
          : balances.associated
            ? balances.usdc.toFixed(2)
            : 'Not associated'
  // HBAR is priced in USD by the merchant, so only dollar assets can be compared with the price.
  const lowBalance =
    asset !== 'HBAR' && balance != null && Number.isFinite(price) && Number.isFinite(Number(balance)) && Number(balance) < price

  const invoke = useCallback(async () => {
    if (inFlight.current || !endpoint || !parsed) return
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    if (!canPay) {
      setError(isEvm ? 'fUSD is not deployed on this network. Switch to HashPack.' : 'Connect a wallet to pay.')
      return
    }
    const evmClient = isEvm ? getEvmWalletClient() : null
    const dappSigner = isEvm ? null : getDappSigner()
    if (isEvm ? !evmClient : !dappSigner || !accountId) {
      setError(`${walletName ?? 'Wallet'} signer unavailable. Reconnect wallet.`)
      return
    }

    inFlight.current = true
    const id = ++runId.current
    const current = () => runId.current === id
    let lastState: PaymentState = 'idle'
    const onState = (s: PaymentState) => {
      lastState = s
      if (current()) setState(s)
    }
    setError('')
    setResult(null)
    setReceipt(null)
    setShowExample(false)

    const op = endpoint
    const title = metaFor(op.operationId).title || op.operationId
    const wallet = accountId ?? evmAddress ?? undefined
    const base = { operationId: op.operationId, title, method: op.method, path: op.path, price: op.price, wallet }
    let path = op.path
    let init: RequestInit = { method: op.method }
    if (op.method === 'GET') path += buildQuery(parsed.value)
    else init = { ...init, headers: { 'content-type': 'application/json' }, body: JSON.stringify(parsed.value) }

    try {
      const response = evmClient
        ? await callPaidResourceWithEvm(evmSignerFromWallet(evmClient), path, init, onState)
        : await callPaidResource(createHashPackHederaSigner(accountId!, dappSigner!), path, init, onState, asset)
      const body = (response.body ?? {}) as ResultEnvelope
      saveTransaction({
        ...base,
        id: `${Date.now()}`,
        at: new Date().toISOString(),
        status: body?.meta?.synthetic && !isProEndpoint(op.operationId) ? 'degraded' : 'settled',
        receipt: response.receipt,
      })
      if (current()) {
        setResult(body)
        setReceipt(response.receipt)
      }
    } catch (e) {
      const message = paymentErrorMessage(e)
      // A declined signature moved no funds: show it, but keep it out of the transaction history.
      if (!isUserRejection(e)) {
        saveTransaction({ ...base, id: `${Date.now()}`, at: new Date().toISOString(), status: 'rejected', error: message })
      }
      if (current()) setError(message)
    } finally {
      // Never leave the button stuck in requesting/signing/settling if the wallet promise ended without a final state.
      if (current() && BUSY_STATES.includes(lastState)) setState('rejected')
      if (current()) inFlight.current = false
      if (evmClient) void refreshFusd()
    }
  }, [endpoint, parsed, canPay, isEvm, getEvmWalletClient, getDappSigner, accountId, evmAddress, walletName, asset, refreshFusd])

  const runLabel =
    state === 'requesting' ? 'Requesting…' : state === 'signing' ? 'Approve in wallet…' : state === 'settling' ? 'Settling…' : `Pay ${endpoint?.price ?? ''} · ${asset}`

  const inputError = parsed && !parsed.ok ? parsed.error : ''

  return (
    <div className="space-y-6 font-mono">
      <div>
        <Link href="/explore" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-3.5 w-3.5" />
          ./dashboard
        </Link>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight uppercase">Run_Endpoint</h1>
      </div>

      {loading ? (
        <div className="border border-border p-8 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading catalog…
        </div>
      ) : catalogError ? (
        <div className="border border-destructive/30 bg-destructive/5 p-4 flex items-center justify-between gap-3 text-sm text-destructive">
          <span className="break-words">Catalog unavailable · {catalogError}</span>
          <Button variant="outline" size="sm" className="rounded-none h-8 text-[10px] uppercase" onClick={() => void loadCatalog()}>
            Retry
          </Button>
        </div>
      ) : !endpoint ? (
        <div className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No endpoints available.</div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-6">
          <section className="space-y-5">
            <Field label="Endpoint">
              <select
                value={endpoint.operationId}
                onChange={(e) => selectEndpoint(e.target.value)}
                disabled={busy}
                className="w-full h-10 rounded-none border border-border bg-background px-3 text-sm outline-none focus:border-foreground disabled:opacity-60"
              >
                {catalog.map((item) => (
                  <option key={item.operationId} value={item.operationId}>
                    {metaFor(item.operationId).title} · {item.price}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
              <MethodTag method={endpoint.method} />
              <span className="truncate" title={`${merchantUrl}${endpoint.path}`}>{endpoint.path}</span>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="run-input" className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {endpoint.method === 'GET' ? 'Query (JSON)' : 'Body (JSON)'}
                </label>
                <button
                  type="button"
                  onClick={() => setInput(exampleInput(endpoint))}
                  disabled={busy}
                  className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  <RotateCcw className="h-3 w-3" /> Reset
                </button>
              </div>
              <textarea
                id="run-input"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  if (error && !busy) setError('')
                }}
                spellCheck={false}
                disabled={busy}
                aria-invalid={Boolean(inputError)}
                className={cn(
                  'w-full h-56 rounded-none border bg-background p-3 font-mono text-xs outline-none focus:border-foreground disabled:opacity-60',
                  inputError ? 'border-destructive' : 'border-border',
                )}
              />
              {inputError && <div className="text-xs text-destructive break-words">{inputError}</div>}
            </div>
          </section>

          <section className="space-y-4">
            <div className="border border-border p-5 space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Pay</div>
                  <div className="text-lg font-bold mt-1 truncate">{meta?.title}</div>
                </div>
                {isProEndpoint(endpoint.operationId) && (
                  <span className="shrink-0 px-1.5 py-0.5 text-[10px] uppercase tracking-wider bg-sky-500/15 text-sky-700 dark:text-sky-400">Pro</span>
                )}
              </div>

              <div className="text-4xl font-bold tracking-tight tabular-nums">{endpoint.price}</div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Asset</div>
                  {isEvm ? (
                    <div className="h-8 border border-border px-3 flex items-center font-semibold">fUSD</div>
                  ) : (
                    <div role="radiogroup" aria-label="Payment asset" className="grid grid-cols-2 border border-border h-8">
                      {(['USDC', 'HBAR'] as const).map((a) => (
                        <button
                          key={a}
                          type="button"
                          role="radio"
                          aria-checked={hederaAsset === a}
                          disabled={busy}
                          onClick={() => setHederaAsset(a)}
                          className={cn(
                            'text-xs font-semibold transition-colors disabled:opacity-60',
                            hederaAsset === a ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {a}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-1.5 min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Balance</div>
                  <div
                    className={cn(
                      'h-8 border border-border px-3 flex items-center truncate tabular-nums',
                      (lowBalance || balance === 'Not associated') && 'text-destructive border-destructive/40',
                    )}
                  >
                    {balance ?? '—'}
                  </div>
                </div>
              </div>

              {connected && walletLabel && (
                <div className="text-[11px] text-muted-foreground truncate" title={walletLabel}>
                  {walletName} · {walletLabel}
                </div>
              )}

              {restoring && !connected ? (
                <Button className="w-full h-12 rounded-none text-sm uppercase tracking-wider" disabled>
                  <Loader2 className="h-4 w-4 animate-spin" /> Restoring wallet…
                </Button>
              ) : !connected ? (
                <div className="[&>div]:w-full [&>div>button]:w-full [&>div>button]:h-12 [&>div>button]:rounded-none [&>div>button]:uppercase [&>div>button]:tracking-wider">
                  <WalletButton />
                </div>
              ) : (
                <Button
                  className="w-full h-12 rounded-none text-sm uppercase tracking-wider"
                  onClick={() => void invoke()}
                  disabled={busy || !canPay || Boolean(inputError)}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
                  {isEvm && !FUSD ? 'fUSD unavailable' : runLabel}
                </Button>
              )}

              {error && <div className="border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive break-words">{error}</div>}
              {!error && lowBalance && <div className="text-xs text-destructive">Low {asset} balance</div>}
              {!error && isEvm && !FUSD && <div className="text-xs text-destructive">fUSD is not deployed on this network</div>}

              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                <span className={cn(state === 'rejected' && 'text-destructive', (state === 'settled' || state === 'degraded') && 'text-foreground')}>
                  State · {state}
                </span>
                {!result && (
                  <button type="button" className="hover:text-foreground underline underline-offset-2" onClick={() => setShowExample((v) => !v)}>
                    {showExample ? 'Hide example' : 'Show example'}
                  </button>
                )}
              </div>
            </div>

            {result ? (
              <ResultPresentation result={result} receipt={receipt} title="Result" />
            ) : showExample && example ? (
              <ResultPresentation result={example} title="Example" preview />
            ) : (
              <div className="border border-dashed border-border p-6 text-center text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                No result yet
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function MethodTag({ method }: { method: string }) {
  return (
    <span
      className={cn(
        'inline-block shrink-0 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider',
        method === 'GET' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
      )}
    >
      {method}
    </span>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
