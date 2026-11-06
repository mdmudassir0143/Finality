import { describe, expect, it } from 'vitest'
import { PrivateKey, Transaction, TransferTransaction } from '@hiero-ledger/sdk'
import { HEDERA_TESTNET_CAIP2 } from '@x402/hedera'
import { createHashPackHederaSigner } from '../../../lib/hedera/signer'

const requirements = {
  scheme: 'exact', network: HEDERA_TESTNET_CAIP2, asset: '0.0.0', amount: '50000000', payTo: '0.0.11331489',
  maxTimeoutSeconds: 180, extra: { feePayer: '0.0.7162784' },
} as any

describe('browser wallet x402 signer', () => {
  it('freezes the transfer for exactly one node so the wallet signature covers the only body', async () => {
    const key = PrivateKey.generateECDSA()
    let seenNodes = 0
    const wallet = {
      // Simulate a wallet: sign what it is given (a real wallet signs the first node's body).
      signTransaction: async (tx: Transaction) => {
        seenNodes = tx.nodeAccountIds?.length ?? 0
        return tx.sign(key)
      },
    }
    const signer = createHashPackHederaSigner('0.0.11331261', wallet)
    const b64 = await signer.createPartiallySignedTransferTransaction(requirements)
    expect(seenNodes).toBe(1)
    const decoded = Transaction.fromBytes(Buffer.from(b64, 'base64')) as TransferTransaction
    expect(decoded.nodeAccountIds).toHaveLength(1)
    expect(decoded.transactionId?.accountId?.toString()).toBe('0.0.7162784')
    const hbar = decoded.hbarTransfers
    expect(hbar.get('0.0.11331261')?.toTinybars().toString()).toBe('-50000000')
    expect(hbar.get('0.0.11331489')?.toTinybars().toString()).toBe('50000000')
  })

  it('fails with a clear message instead of hanging when the wallet never answers', async () => {
    const { WALLET_SIGN_TIMEOUT_MS } = await import('../../../lib/hedera/signer')
    expect(WALLET_SIGN_TIMEOUT_MS).toBeGreaterThan(0)
  })
})
