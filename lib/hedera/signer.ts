import {
  AccountId,
  Client,
  Hbar,
  TokenId,
  TransactionId,
  TransferTransaction,
  type Transaction,
} from '@hiero-ledger/sdk'
import type { PaymentRequirements } from '@x402/core/types'
import type { ClientHederaSigner } from '@x402/hedera'
import { HBAR_ASSET_ID } from '@x402/hedera'
import { HEDERA_CAIP2 } from './config'

function isHbarAsset(asset: string) {
  return asset === HBAR_ASSET_ID || asset === 'HBAR' || asset.toLowerCase() === 'hbar'
}

function clientForCaip2(network: string) {
  return network.includes('mainnet') ? Client.forMainnet() : Client.forTestnet()
}

/** How long to wait for the wallet to approve or reject before giving up (the button must never hang). */
export const WALLET_SIGN_TIMEOUT_MS = 120_000

/** Pick one consensus node from the SDK's network list. */
function pickNode(client: Client): AccountId {
  const nodes = Object.values(client.network).map((n) => (n instanceof AccountId ? n : AccountId.fromString(String(n))))
  if (!nodes.length) throw new Error('No Hedera consensus nodes configured')
  return nodes[Math.floor(Math.random() * nodes.length)]
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** Base64 without relying on a Node Buffer polyfill in the browser bundle. */
function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** Anything that can add the connected wallet's signature to a frozen Hedera transaction
 * (AppKit HederaProvider.hedera_signTransaction, or a classic DAppSigner). */
export type TransactionSigner = { signTransaction: (tx: Transaction) => Promise<Transaction> }

/**
 * Build a ClientHederaSigner that asks the connected native Hedera wallet (HashPack) to sign
 * a frozen TransferTransaction with the facilitator as fee payer.
 *
 * The transaction is frozen for a SINGLE consensus node. A wallet signs the body for one node only
 * (hedera_signTransaction), while the WalletConnect signer copies that signature onto every node's body;
 * with a multi-node freeze all but one copy would carry an invalid signature. One node = one body = one
 * valid signature, which the facilitator verifies and submits to that node.
 */
export function createHashPackHederaSigner(
  accountId: string,
  dappSigner: TransactionSigner,
  network: string = HEDERA_CAIP2,
): ClientHederaSigner {
  const parsedAccountId = AccountId.fromString(accountId)
  return {
    accountId: parsedAccountId.toString(),
    createPartiallySignedTransferTransaction: async (requirements: PaymentRequirements) => {
      const feePayer = requirements.extra?.feePayer
      if (typeof feePayer !== 'string') {
        throw new Error('feePayer is required in paymentRequirements.extra')
      }
      const amount = BigInt(requirements.amount)
      if (amount <= 0n) throw new Error('amount must be greater than zero')

      const payTo = AccountId.fromString(requirements.payTo)
      const tx = new TransferTransaction()
      if (isHbarAsset(requirements.asset)) {
        tx.addHbarTransfer(parsedAccountId, Hbar.fromTinybars((-amount).toString()))
        tx.addHbarTransfer(payTo, Hbar.fromTinybars(amount.toString()))
      } else {
        const tokenId = TokenId.fromString(requirements.asset)
        tx.addTokenTransfer(tokenId, parsedAccountId, -amount)
        tx.addTokenTransfer(tokenId, payTo, amount)
      }
      tx.setTransactionId(TransactionId.generate(AccountId.fromString(feePayer)))

      const client = clientForCaip2(requirements.network || network)
      try {
        tx.setNodeAccountIds([pickNode(client)])
        tx.freezeWith(client)
        const signed = await withTimeout(
          dappSigner.signTransaction(tx as Transaction),
          WALLET_SIGN_TIMEOUT_MS,
          'The wallet did not respond to the signing request. Open HashPack, approve or reject it, or disconnect and reconnect.',
        )
        return bytesToBase64(signed.toBytes())
      } finally {
        client.close()
      }
    },
  }
}
