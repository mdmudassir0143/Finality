'use client'
/**
 * Magic (magic.link) embedded wallet, pointed at Hedera EVM (chain 296 testnet / 295 mainnet via Hashio).
 *
 * Users log in with email (Magic's own UI); Magic holds the key and exposes an EIP-1193 provider, so a Magic session
 * takes the same EVM path as MetaMask: fUSD x402 payments (EIP-712 signature only) and ERC-8004 ratings.
 *
 * Only the publishable key (NEXT_PUBLIC_MAGIC_PUBLISHABLE_KEY) is used in the browser. MAGIC_SECRET_KEY is
 * server-only and is never imported here. The SDK is loaded lazily, so visitors who never pick Magic do not load it.
 */
import type { Magic as MagicInstance } from 'magic-sdk'
import { hedera as hederaEvmMainnet, hederaTestnet as hederaEvmTestnet } from 'viem/chains'
import { HEDERA_NETWORK } from './config'

export const MAGIC_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_MAGIC_PUBLISHABLE_KEY?.trim() ?? ''
export const magicConfigured = MAGIC_PUBLISHABLE_KEY.startsWith('pk_')

/** Which EVM wallet (if any) to restore after a reload. MetaMask and Magic both keep their own session. */
export type RememberedEvmWallet = 'metamask' | 'magic'

/** localStorage key holding the last connected EVM wallet ('metamask' | 'magic'). */
export const EVM_SESSION_FLAG = 'finality:evm-wallet'
/** @deprecated Use EVM_SESSION_FLAG (same key; it now stores 'metamask' or 'magic'). */
export const MAGIC_SESSION_FLAG = EVM_SESSION_FLAG

const chain = HEDERA_NETWORK === 'hedera-mainnet' ? hederaEvmMainnet : hederaEvmTestnet

let instance: Promise<MagicInstance> | null = null

export function getMagic(): Promise<MagicInstance> {
  if (!magicConfigured) {
    return Promise.reject(new Error('Magic is not configured: set NEXT_PUBLIC_MAGIC_PUBLISHABLE_KEY (pk_…) in .env'))
  }
  if (typeof window === 'undefined') return Promise.reject(new Error('Magic is only available in the browser'))
  instance ??= import('magic-sdk')
    .then(({ Magic }) => new Magic(MAGIC_PUBLISHABLE_KEY, { network: { rpcUrl: chain.rpcUrls.default.http[0], chainId: chain.id } }))
    .catch((error) => {
      // Do not cache a failed chunk load (offline, blocked): the next attempt should retry the import.
      instance = null
      throw error
    })
  return instance
}

/** Remember (or forget, with null) which EVM wallet to restore after a reload. */
export function rememberEvmWallet(kind: RememberedEvmWallet | null) {
  try {
    if (kind) window.localStorage.setItem(EVM_SESSION_FLAG, kind)
    else window.localStorage.removeItem(EVM_SESSION_FLAG)
  } catch {
    /* storage blocked: the session just will not be restored */
  }
}

/** The EVM wallet remembered by rememberEvmWallet, or null (also during SSR or with storage blocked). */
export function rememberedEvmWallet(): RememberedEvmWallet | null {
  try {
    if (typeof window === 'undefined') return null
    const v = window.localStorage.getItem(EVM_SESSION_FLAG)
    return v === 'metamask' || v === 'magic' ? v : null
  } catch {
    return null
  }
}
