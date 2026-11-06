import { describe, expect, it } from 'vitest'
import { x402Facilitator } from '@x402/core/facilitator'
import { ExactEvmScheme as FacilitatorScheme } from '@x402/evm/exact/facilitator'
import { ExactEvmScheme as ClientScheme } from '@x402/evm/exact/client'
import { toClientEvmSigner, toFacilitatorEvmSigner } from '@x402/evm'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { verifyTypedData } from 'viem'
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types'
import { createFacilitatorApp } from '../../../facilitator/app'
import { fusdConfig, usdToFusdUnits } from '../../../lib/evm/fusd'

const fusd = fusdConfig('hedera-testnet')!
const payTo = '0x153cc53c83394e6971b26d900d08fef7ae9568e8'
const payer = privateKeyToAccount(generatePrivateKey())
const gasWallet = privateKeyToAccount(generatePrivateKey())

const requirements: PaymentRequirements = {
  scheme: 'exact',
  network: fusd.network,
  asset: fusd.address,
  amount: usdToFusdUnits('$0.15'),
  payTo,
  maxTimeoutSeconds: 180,
  extra: { name: fusd.name, version: fusd.version },
}

/** Chain stub: the payer holds 100 fUSD, no nonce is used, and the transfer simulation succeeds. */
const written: unknown[] = []
const signer = toFacilitatorEvmSigner({
  address: gasWallet.address,
  readContract: async ({ functionName }) => {
    if (functionName === 'name') return fusd.name
    if (functionName === 'version') return fusd.version
    if (functionName === 'balanceOf') return 100_000_000n
    if (functionName === 'authorizationState') return false
    return undefined
  },
  verifyTypedData: (args) => verifyTypedData(args as Parameters<typeof verifyTypedData>[0]),
  writeContract: async (args) => {
    written.push(args)
    return '0xabc0000000000000000000000000000000000000000000000000000000000001'
  },
  sendTransaction: async () => '0x01',
  waitForTransactionReceipt: async () => ({ status: 'success' }),
  getCode: async ({ address }) => (address.toLowerCase() === fusd.address.toLowerCase() ? '0x6080604052' : undefined),
})

const core = new x402Facilitator().register(fusd.network, new FacilitatorScheme(signer))
const app = createFacilitatorApp(core, { networks: [fusd.network], allowedAssets: [fusd.address], allowedPayTo: [payTo], signers: [gasWallet.address] })

async function signedPayload(req: PaymentRequirements = requirements): Promise<PaymentPayload> {
  const client = new ClientScheme(toClientEvmSigner(payer))
  const result = await client.createPaymentPayload(2, req)
  return { x402Version: 2, accepted: req, payload: result.payload, resource: { url: 'http://localhost:4021/v1/market/quotes', description: '', mimeType: 'application/json' } } as PaymentPayload
}

const post = (path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('Finality EVM facilitator (fUSD on Hedera EVM)', () => {
  it('advertises exact on eip155:296 and its gas wallet', async () => {
    const supported = (await (await app.request('/supported')).json()) as { kinds: Array<{ scheme: string; network: string }>; signers: Record<string, string[]> }
    expect(supported.kinds).toContainEqual(expect.objectContaining({ scheme: 'exact', network: 'eip155:296' }))
    const health = (await (await app.request('/health')).json()) as { signers: string[]; assets: string[] }
    expect(health.signers).toEqual([gasWallet.address])
    expect(health.assets).toEqual([fusd.address])
  })

  it('verifies a payer-signed EIP-3009 authorization', async () => {
    const paymentPayload = await signedPayload()
    const res = await post('/verify', { x402Version: 2, paymentPayload, paymentRequirements: requirements })
    const body = (await res.json()) as { isValid: boolean; payer?: string; invalidReason?: string }
    expect(body.invalidReason).toBeUndefined()
    expect(body.isValid).toBe(true)
    expect(body.payer?.toLowerCase()).toBe(payer.address.toLowerCase())
  })

  it('rejects a signature for a smaller amount than required (tampering)', async () => {
    const paymentPayload = await signedPayload({ ...requirements, amount: '1' })
    const res = await post('/verify', { x402Version: 2, paymentPayload, paymentRequirements: requirements })
    expect(((await res.json()) as { isValid: boolean }).isValid).toBe(false)
  })

  it('refuses other assets, networks and payees before touching the chain', async () => {
    const paymentPayload = await signedPayload()
    const cases: Array<[Partial<PaymentRequirements>, string]> = [
      [{ asset: '0x0000000000000000000000000000000000000001' }, 'unsupported_asset'],
      [{ network: 'eip155:8453' }, 'invalid_network'],
      [{ payTo: '0x0000000000000000000000000000000000000002' }, 'payee_not_allowed'],
    ]
    for (const [override, reason] of cases) {
      const res = await post('/settle', { x402Version: 2, paymentPayload, paymentRequirements: { ...requirements, ...override } })
      expect(res.status).toBe(400)
      expect(((await res.json()) as { errorReason: string }).errorReason).toBe(reason)
    }
    expect(written).toHaveLength(0)
  })

  it('settles by submitting transferWithAuthorization from the gas wallet', async () => {
    const paymentPayload = await signedPayload()
    const res = await post('/settle', { x402Version: 2, paymentPayload, paymentRequirements: requirements })
    const body = (await res.json()) as { success: boolean; transaction: string; network: string }
    expect(body.success).toBe(true)
    expect(body.network).toBe('eip155:296')
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({ address: fusd.address, functionName: 'transferWithAuthorization' })
  })

  it('rejects oversized and malformed bodies', async () => {
    const big = await app.request('/verify', { method: 'POST', headers: { 'content-length': '40000' }, body: 'x' })
    expect(big.status).toBe(413)
    const bad = await app.request('/verify', { method: 'POST', body: '{nope' })
    expect(bad.status).toBe(400)
  })

  it('converts USD prices to fUSD base units exactly', () => {
    expect(usdToFusdUnits('$0.15')).toBe('150000')
    expect(usdToFusdUnits('0.1')).toBe('100000')
    expect(usdToFusdUnits('$2')).toBe('2000000')
    expect(() => usdToFusdUnits('0.0000001')).toThrow()
  })
})
