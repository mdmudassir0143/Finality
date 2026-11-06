'use client'
import { x402Client } from '@x402/core/client'
import { wrapFetchWithPayment } from '@x402/fetch'
import { ExactHederaScheme } from '@x402/hedera/exact/client'
import type { ClientHederaSigner } from '@x402/hedera'
import { HBAR_ASSET_ID } from '@x402/hedera'
import { decodePaymentResponseHeader } from '@x402/core/http'
import { ExactEvmScheme } from '@x402/evm/exact/client'
import type { ClientEvmSigner } from '@x402/evm'
import { HEDERA_CAIP2, HEDERA_NETWORK, USDC_TOKEN_ID } from '@/lib/hedera/config'
import { hederaSpendControls } from '@/lib/x402/spend'
import { fusdConfig } from '@/lib/evm/fusd'

export type PaymentState = 'idle' | 'requesting' | 'signing' | 'settling' | 'settled' | 'rejected' | 'degraded'
export type PaymentAsset = 'USDC' | 'HBAR' | 'fUSD'
export const merchantUrl = '/api/x402'

/** fUSD test dollar on Hedera EVM (EIP-3009), paid by EVM wallets through Finality's own facilitator. */
export const FUSD = fusdConfig(HEDERA_NETWORK)

export function createPaidFetch(
  signer: ClientHederaSigner,
  asset: PaymentAsset = 'USDC',
  onState?: (state: PaymentState) => void,
) {
  // fUSD lives on Hedera EVM and is paid through createEvmPaidFetch; never fall back to USDC silently.
  if (asset === 'fUSD') throw new Error('fUSD is paid with an EVM wallet (MetaMask or Magic), not HashPack')
  const preferAsset = asset === 'HBAR' ? HBAR_ASSET_ID : USDC_TOKEN_ID
  const client = x402Client.fromConfig({
    schemes: [{ network: HEDERA_CAIP2, client: new ExactHederaScheme(signer) }],
    spendControls: hederaSpendControls(),
    paymentRequirementsSelector: (_version, requirements) => {
      const match = requirements.find((r) => r.asset === preferAsset || r.extra?.symbol === asset)
      // Never silently pay with a different asset than the one the user picked.
      if (!match) throw new Error(`This endpoint does not accept ${asset} within the spend limit`)
      return match
    },
  })
  client.onBeforePaymentCreation(async () => {
    onState?.('signing')
  })
  client.onAfterPaymentCreation(async () => {
    onState?.('settling')
  })
  client.onPaymentResponse(async () => {
    onState?.('settled')
  })
  return wrapFetchWithPayment(globalThis.fetch, client)
}

/**
 * Paid fetch for an EVM wallet (MetaMask): the wallet signs an EIP-712 TransferWithAuthorization for fUSD on
 * Hedera EVM; Finality's facilitator submits it and pays gas. Only the merchant's eip155 accept is ever chosen.
 */
export function createEvmPaidFetch(signer: ClientEvmSigner, onState?: (state: PaymentState) => void) {
  if (!FUSD) throw new Error(`fUSD is not deployed on ${HEDERA_NETWORK}`)
  const fusd = FUSD
  const client = x402Client.fromConfig({
    schemes: [{ network: fusd.network, client: new ExactEvmScheme(signer) }],
    spendControls: hederaSpendControls({ fusd }),
    paymentRequirementsSelector: (_version, requirements) => {
      const match = requirements.find((r) => r.network === fusd.network && r.asset.toLowerCase() === fusd.address.toLowerCase())
      if (!match) throw new Error('This merchant does not accept fUSD on Hedera EVM yet (its EVM facilitator is not configured). Use HashPack.')
      return match
    },
  })
  client.onBeforePaymentCreation(async () => {
    onState?.('signing')
  })
  client.onAfterPaymentCreation(async () => {
    onState?.('settling')
  })
  return wrapFetchWithPayment(globalThis.fetch, client)
}

export async function callPaidResourceWithEvm(
  signer: ClientEvmSigner,
  path: string,
  init: RequestInit,
  onState?: (state: PaymentState) => void,
) {
  onState?.('requesting')
  try {
    return await readPaidResponse(await createEvmPaidFetch(signer, onState)(`${merchantUrl}${path}`, init), onState, 'fUSD')
  } catch (error) {
    onState?.('rejected')
    throw normalizePaymentError(error)
  }
}

export async function callPaidResource(
  signer: ClientHederaSigner,
  path: string,
  init: RequestInit,
  onState?: (state: PaymentState) => void,
  asset: PaymentAsset = 'USDC',
) {
  onState?.('requesting')
  try {
    return await readPaidResponse(await createPaidFetch(signer, asset, onState)(`${merchantUrl}${path}`, init), onState, asset)
  } catch (error) {
    onState?.('rejected')
    throw normalizePaymentError(error)
  }
}

async function readPaidResponse(response: Response, onState: ((state: PaymentState) => void) | undefined, asset: PaymentAsset) {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    // Facilitator rejections arrive as a 402 with a string error, e.g. invalid_exact_hedera_payload_signature_invalid.
    const reason = typeof body?.error === 'string' ? body.error : body?.error?.message
    const hint =
      response.status === 402
        ? asset === 'fUSD'
          ? ' — the payment was not accepted. Check the fUSD balance of the MetaMask account on Hedera EVM, then retry.'
          : ' — the payment was not accepted. Check the wallet balance for the chosen asset (and USDC association), then retry.'
        : ''
    throw new PaidResponseError(`${reason || `Request failed with HTTP ${response.status}`}${hint}`, response.status)
  }
  if (body?.meta?.synthetic) onState?.('degraded')
  else onState?.('settled')
  // Headers.get is case-insensitive; X-PAYMENT-RESPONSE is the x402 v1 name.
  return { body, receipt: response.headers.get('Payment-Response') || response.headers.get('X-Payment-Response') }
}

/** An HTTP-level failure from the merchant (not a wallet error), so it is never mistaken for a user rejection. */
export class PaidResponseError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'PaidResponseError'
  }
}

export const SIGNATURE_REJECTED = 'Signature rejected'

const REJECTION_CODES = new Set<unknown>([4001, 5000, 5002, 'ACTION_REJECTED', 'USER_REJECTED'])
const REJECTION_TEXT = /user rejected|user denied|user cancel|rejected by (the )?user|request rejected|denied (transaction|message|request)|\brejected\b|\bcancell?ed\b/i

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = []
  let current = error
  while (current && chain.length < 6 && !chain.includes(current)) {
    chain.push(current)
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined
  }
  return chain
}

/** True when the wallet reported that the user declined to sign (EIP-1193 4001, WalletConnect 5000, viem, HashPack). */
export function isUserRejection(error: unknown): boolean {
  if (error instanceof PaidResponseError) return false
  return errorChain(error).some((e) => {
    if (typeof e === 'string') return REJECTION_TEXT.test(e)
    if (!e || typeof e !== 'object') return false
    const v = e as { code?: unknown; name?: unknown; message?: unknown; shortMessage?: unknown }
    if (REJECTION_CODES.has(v.code)) return true
    if (v.name === 'UserRejectedRequestError') return true
    return [v.message, v.shortMessage].some((m) => typeof m === 'string' && REJECTION_TEXT.test(m))
  })
}

/** A short, readable message for any payment failure (wallet errors from viem can be many lines long). */
export function paymentErrorMessage(error: unknown): string {
  if (isUserRejection(error)) return SIGNATURE_REJECTED
  const raw =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object'
        ? String((error as { shortMessage?: unknown }).shortMessage || (error as { message?: unknown }).message || '')
        : ''
  const first = raw.split('\n').map((l) => l.trim()).find(Boolean)
  return first ? (first.length > 300 ? `${first.slice(0, 297)}…` : first) : 'Payment request failed'
}

function normalizePaymentError(error: unknown): Error {
  if (isUserRejection(error)) {
    const rejected = new Error(SIGNATURE_REJECTED)
    ;(rejected as Error & { cause?: unknown }).cause = error
    return rejected
  }
  return error instanceof Error ? error : new Error(paymentErrorMessage(error))
}

export type PaymentReceipt = { success: boolean; transaction: string; network: string; payer?: string }

/** Decode the base64 Payment-Response header into the settlement receipt; null when absent or malformed. */
export function decodeReceipt(header: string | null | undefined): PaymentReceipt | null {
  if (!header) return null
  try {
    const v = decodePaymentResponseHeader(header) as Partial<PaymentReceipt>
    if (typeof v?.transaction !== 'string' || !v.transaction) return null
    return { success: v.success !== false, transaction: v.transaction, network: String(v.network ?? ''), payer: typeof v.payer === 'string' ? v.payer : undefined }
  } catch {
    return null
  }
}

/** HashScan link for a settled receipt (Hedera native tx id or Hedera EVM tx hash). */
export function receiptExplorerUrl(receipt: PaymentReceipt): string | null {
  const net = /mainnet|eip155:295$/.test(receipt.network) ? 'mainnet' : /testnet|eip155:296$/.test(receipt.network) ? 'testnet' : null
  if (!net) return null
  // 0.0.123@1700000000.123456789 -> 0.0.123-1700000000-123456789 (HashScan's transaction id format).
  const id = receipt.transaction.replace(/^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/, '$1-$2-$3')
  return `https://hashscan.io/${net}/transaction/${encodeURIComponent(id)}`
}
