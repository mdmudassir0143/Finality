import { describe, expect, it } from 'vitest'
import { x402Client } from '@x402/core/client'
import { ExactHederaScheme } from '@x402/hedera/exact/client'
import { HBAR_ASSET_ID, HEDERA_TESTNET_CAIP2, HEDERA_TESTNET_USDC } from '@x402/hedera'
import { hederaSpendControls } from '../../../lib/x402/spend'

const signer = {
  accountId: '0.0.5005',
  createPartiallySignedTransferTransaction: async () => Buffer.from('signed-tx').toString('base64'),
}

function requirement(asset: string, amount: string) {
  return {
    scheme: 'exact',
    network: HEDERA_TESTNET_CAIP2,
    asset,
    amount,
    payTo: '0.0.1001',
    maxTimeoutSeconds: 180,
    extra: { feePayer: '0.0.7162784' },
  }
}

const paymentRequired = {
  x402Version: 2,
  resource: { url: 'http://localhost:4021/v1/onchain/hedera/network/supply', description: '', mimeType: 'application/json' },
  accepts: [requirement(HEDERA_TESTNET_USDC, '100000'), requirement(HBAR_ASSET_ID, '50000000')],
}

function clientFor(asset: 'USDC' | 'HBAR', spendControls?: ReturnType<typeof hederaSpendControls>) {
  return x402Client.fromConfig({
    schemes: [{ network: HEDERA_TESTNET_CAIP2, client: new ExactHederaScheme(signer as any) }],
    ...(spendControls ? { spendControls } : {}),
    paymentRequirementsSelector: (_v, reqs) => {
      const want = asset === 'HBAR' ? HBAR_ASSET_ID : HEDERA_TESTNET_USDC
      const match = reqs.find((r) => r.asset === want)
      if (!match) throw new Error(`${asset} option was filtered out`)
      return match
    },
  })
}

describe('client spend controls for Hedera', () => {
  it('drops the HBAR option with plain USD-only spend controls (the original bug)', async () => {
    const client = clientFor('HBAR', { maxAmountPerPayment: '$5' } as any)
    await expect(client.createPaymentPayload(paymentRequired as any)).rejects.toThrow()
  })

  it('pays in HBAR with hederaSpendControls', async () => {
    const payload = await clientFor('HBAR', hederaSpendControls()).createPaymentPayload(paymentRequired as any)
    expect(payload.accepted.asset).toBe(HBAR_ASSET_ID)
    expect(payload.accepted.amount).toBe('50000000')
  })

  it('still pays in USDC with hederaSpendControls', async () => {
    const payload = await clientFor('USDC', hederaSpendControls()).createPaymentPayload(paymentRequired as any)
    expect(payload.accepted.asset).toBe(HEDERA_TESTNET_USDC)
  })

  it('enforces the tinybar cap', async () => {
    const client = clientFor('HBAR', hederaSpendControls({ maxTinybars: '10000000' }))
    await expect(client.createPaymentPayload(paymentRequired as any)).rejects.toThrow()
  })
})

describe('tinybar pricing uses integer math', () => {
  it('converts catalog USD prices exactly', async () => {
    const { tinybarsFromUsd } = await import('../../config/payment')
    expect(tinybarsFromUsd('$0.15', 0.2)).toBe('75000000')
    expect(tinybarsFromUsd('$0.10', 0.25)).toBe('40000000')
    expect(tinybarsFromUsd('$3.10', 0.2)).toBe('1550000000')
    // 0.1 / 0.3 = 0.333… HBAR → 33,333,333.33 tinybars → rounds to 33,333,333
    expect(tinybarsFromUsd('$0.10', 0.3)).toBe('33333333')
    expect(tinybarsFromUsd('$0', 0.2)).toBe('1')
  })
})
