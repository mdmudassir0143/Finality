'use client'

/**
 * One wallet modal for Hedera, built with Reown AppKit:
 * - `hedera` namespace (HederaAdapter + HederaProvider): HashPack and other native Hedera wallets. These sign
 *   the partially signed TransferTransaction that x402 on Hedera settles through Blocky402.
 * - `eip155` namespace (HederaAdapter, chain 296 via Hashio): MetaMask and other EVM wallets, used for ERC-8004
 *   identity and reputation on Hedera EVM, and for x402 in fUSD (EIP-3009 test dollar) settled by Finality's own
 *   facilitator (Step 14b). EVM writes and EIP-712 signatures go through viem on the wallet's EIP-1193 provider.
 *   (HederaAdapter's eip155 mode is marked deprecated in favour of WagmiAdapter; wagmi 3's optional peer chain
 *   conflicts with this app's dependencies, so the dependency-free path is used deliberately.)
 * An EVM address is resolved to its Hedera account (0.0.x) through the Mirror Node, so balances show either way.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type UniversalProvider from '@walletconnect/universal-provider'
import { createAppKit } from '@reown/appkit'
import {
  HederaAdapter,
  HederaChainDefinition,
  HederaProvider,
  hederaNamespace,
  transactionToBase64String,
} from '@hashgraph/hedera-wallet-connect'
import { AccountId, Client, TokenAssociateTransaction, TokenId, TransactionId, type Transaction } from '@hiero-ledger/sdk'
import { createWalletClient, custom, type Address, type WalletClient } from 'viem'
import { hedera as hederaEvmMainnet, hederaTestnet as hederaEvmTestnet } from 'viem/chains'
import { HEDERA_NETWORK, MIRROR_NODE_URL, USDC_TOKEN_ID, WALLETCONNECT_PROJECT_ID } from './config'
import type { TransactionSigner } from './signer'
import { getMagic, magicConfigured, rememberEvmWallet, rememberedEvmWallet } from './magic'

type Balances = { hbar: number; usdc: number; associated: boolean }
export type WalletNamespace = 'hedera' | 'eip155'
/** What the Connect chooser can open: HashPack ('hedera'), MetaMask ('eip155') or a Magic email wallet ('magic'). */
export type ConnectKind = WalletNamespace | 'magic'
/** Which wallet backs an EVM session. */
export type EvmWalletKind = 'metamask' | 'magic'

type HederaWalletContextValue = {
  ready: boolean
  /** True while a wallet session exists (HashPack, MetaMask or Magic), even before a Hedera account id resolves. */
  connected: boolean
  /** True until the wallet kit is ready and any previous session (AppKit / Magic) has had a chance to restore. */
  restoring: boolean
  /** Lowercased identifiers of the connected wallet (0.0.x and/or 0x…), for filtering per-wallet data. */
  walletIds: string[]
  /** Hedera account id (0.0.x). For EVM sessions it is resolved from the EVM address via the Mirror Node. */
  accountId: string | null
  /** EVM address (0x…) of the connected account, when known. */
  evmAddress: string | null
  namespace: WalletNamespace | null
  /** True only for native Hedera sessions: x402 on Hedera is settled from a natively signed transfer. */
  canPayX402: boolean
  connecting: boolean
  balances: Balances | null
  /** Which wallet backs an EVM session (MetaMask or Magic), else null. */
  evmWallet: EvmWalletKind | null
  /** True when NEXT_PUBLIC_MAGIC_PUBLISHABLE_KEY is set, so the Magic option can be offered. */
  magicAvailable: boolean
  /** 'hedera' (HashPack, default), 'eip155' (MetaMask) or 'magic' (email wallet on Hedera EVM). */
  connect: (kind?: ConnectKind) => Promise<void>
  disconnect: () => Promise<void>
  /**
   * Full disconnect, then connect `kind` (e.g. 'hedera' opens the HashPack modal). Without `kind` it only
   * disconnects, so the caller can show the wallet chooser again.
   */
  switchWallet: (kind?: ConnectKind) => Promise<void>
  /** True when a MetaMask session is on a chain other than Hedera EVM (296 testnet / 295 mainnet). */
  wrongNetwork: boolean
  /** Ask MetaMask to switch (or add) Hedera EVM. No-op for other wallets. */
  switchToHederaNetwork: () => Promise<void>
  associateUsdc: () => Promise<void>
  refreshBalances: () => Promise<void>
  getDappSigner: () => TransactionSigner | null
  /** viem wallet client on the connected EVM wallet (chain 296/295) for EVM writes such as ERC-8004 feedback. */
  getEvmWalletClient: () => WalletClient | null
}

const HederaWalletContext = createContext<HederaWalletContextValue | null>(null)

const isMainnet = HEDERA_NETWORK === 'hedera-mainnet'
const nativeNetwork = isMainnet ? HederaChainDefinition.Native.Mainnet : HederaChainDefinition.Native.Testnet
const evmChain = isMainnet ? hederaEvmMainnet : hederaEvmTestnet

type Eip1193 = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>
  on?: (event: string, cb: (...a: any[]) => void) => void
  removeListener?: (event: string, cb: (...a: any[]) => void) => void
}

/**
 * Find MetaMask's EIP-1193 provider. EIP-6963 discovery picks MetaMask explicitly (Brave and others also inject
 * window.ethereum); window.ethereum is the fallback for older wallets.
 */
async function findEvmProvider(): Promise<Eip1193 | null> {
  const found: Array<{ info: { rdns: string; name: string }; provider: Eip1193 }> = []
  const onAnnounce = (e: Event) => found.push((e as CustomEvent).detail)
  window.addEventListener('eip6963:announceProvider', onAnnounce)
  window.dispatchEvent(new Event('eip6963:requestProvider'))
  await new Promise((r) => setTimeout(r, 300))
  window.removeEventListener('eip6963:announceProvider', onAnnounce)
  const metamask = found.find((d) => d.info.rdns === 'io.metamask') ?? found.find((d) => /metamask/i.test(d.info.name))
  log('evm providers', found.map((d) => d.info.rdns))
  return metamask?.provider ?? (window as unknown as { ethereum?: Eip1193 }).ethereum ?? null
}

/** Ask the wallet to use Hedera EVM (chain 296/295), adding the network if it is unknown. */
async function ensureHederaEvmChain(provider: Eip1193) {
  const chainIdHex = `0x${evmChain.id.toString(16)}`
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] })
  } catch (error) {
    if ((error as { code?: number })?.code !== 4902) throw error
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: chainIdHex,
        chainName: isMainnet ? 'Hedera Mainnet' : 'Hedera Testnet',
        nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 18 },
        rpcUrls: [evmChain.rpcUrls.default.http[0]],
        blockExplorerUrls: [`https://hashscan.io/${isMainnet ? 'mainnet' : 'testnet'}`],
      }],
    })
  }
}
const nativeChain = isMainnet ? 'hedera:mainnet' : 'hedera:testnet'

/** EIP-1193 user rejection (4001), WalletConnect user rejected (5000), Magic user rejected / cancelled. */
const REJECTION_CODES = new Set([4001, 5000, -10012, -10014])

function errorParts(error: unknown): { code?: number; message: string } {
  const e = error as { code?: unknown; message?: unknown; cause?: { code?: unknown; message?: unknown } } | null
  const code = typeof e?.code === 'number' ? e.code : typeof e?.cause?.code === 'number' ? e.cause.code : undefined
  const message = [e?.message, e?.cause?.message].filter((m) => typeof m === 'string').join(' ')
  return { code, message: message || (typeof error === 'string' ? error : '') }
}

/** True when the user declined the request in their wallet (MetaMask, WalletConnect / HashPack or Magic). */
export function isUserRejection(error: unknown): boolean {
  const { code, message } = errorParts(error)
  return (code !== undefined && REJECTION_CODES.has(code)) || /user (rejected|denied|cancel)|(rejected|denied|cancell?ed) by (the )?user|request (was )?(rejected|cancell?ed)/i.test(message)
}

/** Short, readable wallet error for the UI. */
export function walletErrorMessage(error: unknown, fallback = 'Wallet action failed'): string {
  if (isUserRejection(error)) return 'Request rejected'
  const { code, message } = errorParts(error)
  if (code === -32002) return 'A wallet request is already open. Finish it in your wallet.'
  return message.trim() || fallback
}

/** Tagged console logs so wallet issues can be diagnosed from the browser console (filter: finality-wallet). */
const log = (...args: unknown[]) => console.info('[finality-wallet]', ...args)

type Kit = { appKit: ReturnType<typeof createAppKit>; provider: HederaProvider }
/**
 * AppKit is a browser singleton, created once after mount (never during SSR). It lives on globalThis rather than
 * in module scope: in development, Next can evaluate this module more than once (HMR / separate chunks), and a
 * second init creates a second WalletConnect Core that fights the first over the same session.
 */
const kitStore = globalThis as typeof globalThis & { __finalityWalletKit?: Promise<Kit> }

function getKit(): Promise<Kit> {
  if (!kitStore.__finalityWalletKit) {
    kitStore.__finalityWalletKit = (async () => {
      const metadata = {
        name: 'Finality',
        description: 'Pay-per-request market intelligence on Hedera (x402)',
        url: window.location.origin,
        icons: ['https://finality.accuracy.wtf/logo.webp'],
      }
      const nativeAdapter = new HederaAdapter({
        projectId: WALLETCONNECT_PROJECT_ID,
        networks: [nativeNetwork],
        namespace: hederaNamespace,
      })
      const provider = await HederaProvider.init({ projectId: WALLETCONNECT_PROJECT_ID, metadata })
      // Local debugging only: with localStorage['finality:debug'] = '1' the WalletConnect pairing URI is logged so a
      // test wallet can pair with this page. Never on by default.
      provider.on('display_uri', (uri: string) => {
        try {
          if (window.localStorage.getItem('finality:debug') === '1') log('pairing uri', uri)
        } catch {
          /* storage unavailable */
        }
      })
      const appKit = createAppKit({
        adapters: [nativeAdapter],
        universalProvider: provider as unknown as UniversalProvider,
        projectId: WALLETCONNECT_PROJECT_ID,
        metadata,
        networks: [nativeNetwork],
        defaultNetwork: nativeNetwork,
        features: { analytics: false, email: false, socials: false, swaps: false, onramp: false },
      })
      return { appKit, provider }
    })()
  }
  return kitStore.__finalityWalletKit
}

function parseCaipAddress(caip: string | undefined): { namespace: WalletNamespace; address: string } | null {
  if (!caip) return null
  const [ns, , address] = caip.split(':')
  if (ns === 'hedera' && address) return { namespace: 'hedera', address }
  if (ns === 'eip155' && address) return { namespace: 'eip155', address }
  return null
}

async function mirrorAccount(idOrEvm: string) {
  const res = await fetch(`${MIRROR_NODE_URL}/api/v1/accounts/${idOrEvm}`)
  if (!res.ok) throw new Error(`Mirror ${res.status}`)
  return (await res.json()) as {
    account: string
    evm_address?: string
    balance?: { balance: number; tokens?: Array<{ token_id: string; balance: number }> }
  }
}

/** A MetaMask or Magic EIP-1193 session (not managed by AppKit), with a cleanup for its event listeners. */
type EvmLink = { provider: Eip1193; kind: EvmWalletKind; detach: () => void }

/** Wallet methods whose result depends on the wallet's active chain; Hedera EVM is ensured before them. */
const CHAIN_BOUND_METHODS = new Set([
  'eth_chainId',
  'eth_sendTransaction',
  'eth_signTypedData_v4',
  'wallet_sendCalls',
])

const parseChainId = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Number.parseInt(v, v.startsWith('0x') ? 16 : 10) : NaN)

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promise, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))])
}

export function HederaWalletProvider({ children }: { children: ReactNode }) {
  const [kit, setKit] = useState<Kit | null>(null)
  const [kitFailed, setKitFailed] = useState(false)
  const [session, setSession] = useState<{ namespace: WalletNamespace; address: string } | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [evmAddress, setEvmAddress] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [balances, setBalances] = useState<Balances | null>(null)
  /** Set by an explicit Disconnect; cleared when the user starts a new connection. */
  const userDisconnected = useRef(false)
  /** MetaMask or Magic session when an EVM session is active (not managed by AppKit). */
  const evmLink = useRef<EvmLink | null>(null)
  const [evmWallet, setEvmWallet] = useState<EvmWalletKind | null>(null)
  /** Active chain of the EVM wallet (MetaMask can switch away from Hedera EVM at any time). */
  const [evmChainId, setEvmChainId] = useState<number | null>(null)
  /** Pending EVM session restore (MetaMask / Magic); cleared once the attempt finishes. */
  const [restoringEvm, setRestoringEvm] = useState(true)
  /** Bumped by every connect / disconnect so a slower restore or connect cannot overwrite a newer choice. */
  const evmEpoch = useRef(0)
  /** Latest session, for async callbacks (balance fetches, restores) that must not act on a stale one. */
  const sessionRef = useRef(session)
  // Layout effect: runs before the passive effects below (balance refresh) see the new session.
  useLayoutEffect(() => {
    sessionRef.current = session
  }, [session])
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  /** Drop the EVM session's listeners and provider (does not touch the remembered flag or the session). */
  const detachEvm = useCallback(() => {
    evmLink.current?.detach()
    evmLink.current = null
    setEvmWallet(null)
    setEvmChainId(null)
  }, [])

  /** Make `provider` the active EVM session and (for MetaMask) follow account and chain changes. */
  const attachEvm = useCallback((provider: Eip1193, kind: EvmWalletKind, address: string, chainId: number) => {
    evmLink.current?.detach()
    const link: EvmLink = { provider, kind, detach: () => {} }
    if (kind === 'metamask' && provider.on) {
      const onAccounts = (list: unknown) => {
        if (evmLink.current !== link) return
        const accounts = Array.isArray(list) ? (list as string[]) : []
        log('metamask accountsChanged', accounts)
        if (accounts.length) {
          setSession({ namespace: 'eip155', address: accounts[0] })
          return
        }
        // Locked, or the site was disconnected from inside MetaMask.
        link.detach()
        evmLink.current = null
        rememberEvmWallet(null)
        setEvmWallet(null)
        setEvmChainId(null)
        setSession((prev) => (prev?.namespace === 'eip155' ? null : prev))
      }
      const onChain = (id: unknown) => {
        if (evmLink.current !== link) return
        log('metamask chainChanged', id)
        setEvmChainId(parseChainId(id))
      }
      provider.on('accountsChanged', onAccounts)
      provider.on('chainChanged', onChain)
      link.detach = () => {
        provider.removeListener?.('accountsChanged', onAccounts)
        provider.removeListener?.('chainChanged', onChain)
      }
    }
    evmLink.current = link
    setEvmWallet(kind)
    setEvmChainId(chainId)
    setSession({ namespace: 'eip155', address })
  }, [])

  // Restore a MetaMask or Magic session after a reload without any prompt: eth_accounts only returns accounts the
  // site is already permitted to see (never eth_requestAccounts here), and Magic keeps its own login.
  useEffect(() => {
    const remembered = rememberedEvmWallet()
    if (!remembered || (remembered === 'magic' && !magicConfigured)) {
      setRestoringEvm(false)
      return
    }
    let cancelled = false
    const epoch = evmEpoch.current
    const stale = () => cancelled || epoch !== evmEpoch.current || userDisconnected.current || sessionRef.current !== null
    ;(async () => {
      try {
        let provider: Eip1193 | null
        if (remembered === 'magic') {
          const magic = await getMagic()
          if (!(await magic.user.isLoggedIn())) {
            if (!stale()) rememberEvmWallet(null)
            return
          }
          provider = magic.rpcProvider as unknown as Eip1193
        } else {
          provider = await findEvmProvider()
          if (!provider) return log('metamask restore skipped: provider not found')
        }
        const accounts = (await provider.request({ method: 'eth_accounts' })) as string[] | undefined
        if (stale()) return
        if (!accounts?.length) {
          rememberEvmWallet(null)
          return log(`${remembered} restore skipped: no permitted account`)
        }
        const chainId = remembered === 'magic' ? evmChain.id : parseChainId(await provider.request({ method: 'eth_chainId' }))
        if (stale()) return
        attachEvm(provider, remembered, accounts[0], chainId)
        log(`${remembered} restored`, accounts[0], { chainId })
      } catch (error) {
        log('evm restore skipped', String(error))
      } finally {
        if (!cancelled) setRestoringEvm(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [attachEvm])

  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    let unsubscribeState: (() => void) | undefined
    let cancelled = false
    getKit()
      .then((k) => {
        if (cancelled) return
        setKit(k)
        log('wallet kit ready', { network: HEDERA_NETWORK })
        unsubscribe = k.appKit.subscribeAccount((account) => {
          let next = account?.isConnected ? parseCaipAddress(account.caipAddress) : null
          // AppKit can re-announce the previous account right after a disconnect. Trust it only if the user has
          // not just disconnected, and (for Hedera) only while a live WalletConnect session actually exists.
          if (next && userDisconnected.current) next = null
          if (next?.namespace === 'hedera' && !k.provider.session) next = null
          if (next && next.namespace !== 'hedera') next = null // AppKit handles Hedera native only
          log('account', next ? account?.caipAddress : 'disconnected')
          // A live HashPack session replaces any EVM session; drop the EVM listeners so they cannot fire later.
          if (next && evmLink.current) {
            evmLink.current.detach()
            evmLink.current = null
            setEvmWallet(null)
            setEvmChainId(null)
          }
          // Never let an AppKit (Hedera) event clobber a MetaMask (EVM) session, which is managed separately.
          setSession((prev) => next ?? (prev?.namespace === 'eip155' ? prev : null))
        })
        unsubscribeState = k.appKit.subscribeState((state) => setConnecting(Boolean(state.open)))
      })
      .catch((error) => {
        console.error('Wallet kit init failed', error)
        if (!cancelled) setKitFailed(true)
      })
    return () => {
      cancelled = true
      unsubscribe?.()
      unsubscribeState?.()
    }
  }, [])

  const refreshBalances = useCallback(async () => {
    const current = session
    if (!current) {
      setAccountId(null)
      setEvmAddress(null)
      setBalances(null)
      return
    }
    // Ignore a response that arrives after the session changed (account switch, disconnect) or after unmount.
    const isCurrent = () => alive.current && sessionRef.current === current
    try {
      const body = await mirrorAccount(current.address)
      if (!isCurrent()) return
      const usdc = body.balance?.tokens?.find((t) => t.token_id === USDC_TOKEN_ID)
      setAccountId(body.account)
      setEvmAddress(body.evm_address ?? (current.namespace === 'eip155' ? current.address : null))
      setBalances({
        hbar: Number(body.balance?.balance ?? 0) / 1e8,
        usdc: Number(usdc?.balance ?? 0) / 1e6,
        associated: Boolean(usdc),
      })
    } catch {
      if (!isCurrent()) return
      // Unknown to the Mirror Node yet (e.g. a fresh EVM address with no Hedera account).
      setAccountId(current.namespace === 'hedera' ? current.address : null)
      setEvmAddress(current.namespace === 'eip155' ? current.address : null)
      setBalances(null)
    }
  }, [session])

  useEffect(() => {
    void refreshBalances()
  }, [refreshBalances])

  const connectEvm = useCallback(async (epoch: number) => {
    const provider = await findEvmProvider()
    if (!provider) throw new Error('MetaMask was not found. Install or enable the MetaMask extension (in Brave: Settings → Wallet → Default Ethereum wallet → Extensions).')
    const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[]
    if (!accounts?.length) throw new Error('MetaMask returned no account')
    await ensureHederaEvmChain(provider)
    const chainId = parseChainId(await provider.request({ method: 'eth_chainId' }))
    if (epoch !== evmEpoch.current) return
    attachEvm(provider, 'metamask', accounts[0], chainId)
    rememberEvmWallet('metamask')
    log('metamask connected', accounts[0], { chainId })
  }, [attachEvm])

  /** Magic email login (Magic's own UI), then use its EIP-1193 provider on Hedera EVM like MetaMask. */
  const connectMagic = useCallback(async (epoch: number) => {
    const magic = await getMagic()
    const accounts = await magic.wallet.connectWithUI()
    if (!accounts?.length) throw new Error('Magic returned no account')
    if (epoch !== evmEpoch.current) return
    attachEvm(magic.rpcProvider as unknown as Eip1193, 'magic', accounts[0], evmChain.id)
    rememberEvmWallet('magic')
    log('magic connected', accounts[0])
  }, [attachEvm])

  const connect = useCallback(async (kind: ConnectKind = 'hedera') => {
    userDisconnected.current = false
    const epoch = ++evmEpoch.current
    if (kind === 'magic') return connectMagic(epoch)
    if (kind === 'eip155') return connectEvm(epoch)
    const k = kit ?? (await getKit())
    log('connect', kind)
    // Filtering by namespace keeps HashPack on the native Hedera path; picking an injected wallet in an unfiltered
    // modal can otherwise connect it as an EVM wallet, which cannot sign x402 payments on Hedera.
    await k.appKit.open({ view: 'Connect', namespace: hederaNamespace })
  }, [kit, connectEvm, connectMagic])

  /**
   * Disconnect everything: both AppKit namespaces and the underlying WalletConnect session, so a stale
   * HashPack session cannot silently reconnect (or leave a signing request unanswered) afterwards.
   */
  const disconnect = useCallback(async () => {
    log('disconnect requested')
    userDisconnected.current = true
    evmEpoch.current++
    setSession(null)
    setAccountId(null)
    setEvmAddress(null)
    setBalances(null)
    rememberEvmWallet(null)
    // Detach first, so the accountsChanged([]) that a revoke triggers is not handled as a second disconnect.
    const link = evmLink.current
    detachEvm()
    if (link?.kind === 'magic') {
      // Magic: end the Magic session so the next connect asks for the email login again. Bounded, so a slow
      // Magic iframe cannot keep the UI in "Disconnecting…".
      try {
        await withTimeout((await getMagic()).user.logout(), 5000)
      } catch (error) {
        log('magic logout skipped', String(error))
      }
    } else if (link) {
      // MetaMask has no programmatic disconnect; revoking the account permission is the closest equivalent.
      try {
        await withTimeout(link.provider.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }), 5000)
      } catch {
        /* older MetaMask: forgetting the provider is enough */
      }
    }
    if (!kit) return
    // Disconnect only what is connected: asking an adapter that never connected to disconnect throws
    // ("Please call connect() before enable()") and used to abort the rest of the cleanup.
    const namespaces = [hederaNamespace, 'eip155' as typeof hederaNamespace]
    for (const ns of namespaces.filter((n) => kit.appKit.getCaipAddress(n))) {
      try {
        await kit.appKit.disconnect(ns)
      } catch (error) {
        log(`appkit disconnect ${ns}`, String(error))
      }
    }
    if (kit.provider.session) {
      try {
        await kit.provider.disconnect()
      } catch (error) {
        log('walletconnect session already closed', String(error))
      }
    }
    // Drop every WalletConnect pairing too. Otherwise HashPack reuses the old pairing and silently reconnects the
    // same account; with no pairing left, the next connect asks the wallet to approve and choose an account again.
    const pairing = kit.provider.client?.core?.pairing
    for (const p of pairing?.getPairings() ?? []) {
      try {
        await pairing?.disconnect({ topic: p.topic })
      } catch (error) {
        log('pairing cleanup skipped', String(error))
      }
    }
    // Force AppKit's own account state back to disconnected, otherwise its modal can keep showing the old account.
    for (const ns of namespaces) {
      try {
        kit.appKit.resetAccount(ns)
        kit.appKit.setStatus('disconnected', ns)
      } catch (error) {
        log(`appkit reset ${ns}`, String(error))
      }
    }
    log('disconnected (session and pairings cleared)')
  }, [kit, detachEvm])

  const switchWallet = useCallback(async (kind?: ConnectKind) => {
    await disconnect()
    if (kind) await connect(kind)
  }, [disconnect, connect])

  const switchToHederaNetwork = useCallback(async () => {
    const link = evmLink.current
    if (!link || link.kind !== 'metamask') return
    await ensureHederaEvmChain(link.provider)
    const chainId = parseChainId(await link.provider.request({ method: 'eth_chainId' }))
    if (evmLink.current === link && alive.current) setEvmChainId(chainId)
  }, [])

  const nativeSigner = useCallback((): TransactionSigner | null => {
    if (!kit || session?.namespace !== 'hedera' || !accountId) return null
    const signerAccountId = `${nativeChain}:${accountId}`
    return {
      signTransaction: async (tx: Transaction) => {
        log('requesting signature', { signerAccountId, transactionId: tx.transactionId?.toString() })
        try {
          const signed = await kit.provider.hedera_signTransaction({ signerAccountId, transactionBody: tx })
          log('signature received')
          return signed
        } catch (error) {
          const e = error as { code?: number; message?: string }
          log('signature failed', JSON.stringify(error), e?.message)
          throw new Error(
            isUserRejection(error)
              ? 'Payment signature was rejected in your wallet.'
              : `Wallet could not sign the payment${e?.code ? ` (code ${e.code})` : ''}${e?.message ? `: ${e.message}` : ''}. Disconnect, reconnect HashPack and try again.`,
          )
        }
      },
    }
  }, [kit, session, accountId])

  const associateUsdc = useCallback(async () => {
    if (!kit || session?.namespace !== 'hedera' || !accountId) throw new Error('Connect a Hedera wallet (HashPack) first')
    const account = AccountId.fromString(accountId)
    const client = isMainnet ? Client.forMainnet() : Client.forTestnet()
    try {
      const tx = new TokenAssociateTransaction()
        .setAccountId(account)
        .setTokenIds([TokenId.fromString(USDC_TOKEN_ID)])
        .setTransactionId(TransactionId.generate(account))
        .freezeWith(client)
      await kit.provider.hedera_signAndExecuteTransaction({
        signerAccountId: `${nativeChain}:${accountId}`,
        transactionList: transactionToBase64String(tx),
      })
    } finally {
      client.close()
    }
    await refreshBalances()
  }, [kit, session, accountId, refreshBalances])

  const getEvmWalletClient = useCallback((): WalletClient | null => {
    const link = evmLink.current
    if (session?.namespace !== 'eip155' || !link) return null
    const { provider } = link
    // MetaMask may have been switched to another chain since connecting: re-prompt for Hedera EVM right before a
    // chain-bound call (viem reads eth_chainId before a write; EIP-712 domains carry chain 296), not on page load.
    const request = async (args: { method: string; params?: unknown }) => {
      if (link.kind === 'metamask' && CHAIN_BOUND_METHODS.has(args.method)) {
        const current = parseChainId(await provider.request({ method: 'eth_chainId' }))
        if (current !== evmChain.id) {
          await ensureHederaEvmChain(provider)
          if (evmLink.current === link && alive.current) setEvmChainId(evmChain.id)
        }
        if (args.method === 'eth_chainId') return provider.request({ method: 'eth_chainId' })
      }
      return provider.request(args)
    }
    return createWalletClient({ account: session.address as Address, chain: evmChain, transport: custom({ request }) })
  }, [session])

  const wrongNetwork = session?.namespace === 'eip155' && evmWallet === 'metamask' && evmChainId !== null && evmChainId !== evmChain.id

  const value = useMemo<HederaWalletContextValue>(
    () => ({
      ready: Boolean(kit),
      connected: Boolean(session),
      // A failed kit init must not leave wallet-gated pages on a spinner forever.
      restoring: (!kit && !kitFailed) || restoringEvm,
      walletIds: [...new Set([accountId, evmAddress, session?.address].filter((v): v is string => Boolean(v)).map((v) => v.toLowerCase()))],
      accountId,
      evmAddress,
      namespace: session?.namespace ?? null,
      evmWallet: session?.namespace === 'eip155' ? evmWallet : null,
      magicAvailable: magicConfigured,
      canPayX402: session?.namespace === 'hedera' && Boolean(accountId),
      connecting,
      balances,
      wrongNetwork,
      connect,
      disconnect,
      switchWallet,
      switchToHederaNetwork,
      associateUsdc,
      refreshBalances,
      getDappSigner: nativeSigner,
      getEvmWalletClient,
    }),
    [kit, kitFailed, restoringEvm, accountId, evmAddress, session, evmWallet, connecting, balances, wrongNetwork, connect, disconnect, switchWallet, switchToHederaNetwork, associateUsdc, refreshBalances, nativeSigner, getEvmWalletClient],
  )

  return <HederaWalletContext.Provider value={value}>{children}</HederaWalletContext.Provider>
}

export function useHederaWallet() {
  const ctx = useContext(HederaWalletContext)
  if (!ctx) throw new Error('useHederaWallet must be used within HederaWalletProvider')
  return ctx
}
