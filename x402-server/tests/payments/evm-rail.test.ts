import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { x402Client } from '@x402/core/client'
import { x402Facilitator } from '@x402/core/facilitator'
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from '@x402/core/http'
import { ExactEvmScheme as ClientEvmScheme } from '@x402/evm/exact/client'
import { ExactEvmScheme as FacilitatorEvmScheme } from '@x402/evm/exact/facilitator'
import { toClientEvmSigner, toFacilitatorEvmSigner } from '@x402/evm'
import { HEDERA_TESTNET_CAIP2, HEDERA_TESTNET_USDC, HBAR_ASSET_ID } from '@x402/hedera'
import { verifyTypedData } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createApp } from '../../app'
import { testEnv } from '../helpers'
import { createFacilitatorApp } from '../../../facilitator/app'
import { fusdConfig } from '../../../lib/evm/fusd'
import { hederaSpendControls } from '../../../lib/x402/spend'
import { AuditPublisher } from '../../../lib/hedera/hcs'
import { decodeAuditMessage } from '../../../lib/hedera/audit'
import { discoveryContext, wellKnownX402 } from '../../discovery/platform'

const fusd = fusdConfig('hedera-testnet')!
const EVM_FACILITATOR = 'http://evm-facilitator.test'
const EVM_PAYTO = '0x153cc53c83394e6971b26d900d08fef7ae9568e8'
const EVM_TX = '0x613036b4dab7fffface16dd6761afea91228f78e35f11d460c85b40287dacfb9'
const evmEnv = { ...testEnv, X402_EVM_FACILITATOR_URL: EVM_FACILITATOR, X402_EVM_PAYTO_ADDRESS: EVM_PAYTO }

const payer = privateKeyToAccount(generatePrivateKey())
const gasWallet = privateKeyToAccount(generatePrivateKey())

/** Our facilitator app on a stubbed chain (payer holds 100 fUSD; settlement returns EVM_TX). */
function evmFacilitatorApp() {
  const writes: unknown[] = []
  const signer = toFacilitatorEvmSigner({
    address: gasWallet.address,
    readContract: async ({ functionName }) =>
      ({ name: fusd.name, version: fusd.version, balanceOf: 100_000_000n, authorizationState: false })[functionName as string],
    verifyTypedData: (args) => verifyTypedData(args as Parameters<typeof verifyTypedData>[0]),
    writeContract: async (args) => {
      writes.push(args)
      return EVM_TX
    },
    sendTransaction: async () => EVM_TX,
    waitForTransactionReceipt: async () => ({ status: 'success' }),
    getCode: async ({ address }) => (address.toLowerCase() === fusd.address.toLowerCase() ? '0x60806040' : undefined),
  })
  const core = new x402Facilitator().register(fusd.network, new FacilitatorEvmScheme(signer))
  const app = createFacilitatorApp(core, { networks: [fusd.network], allowedAssets: [fusd.address], allowedPayTo: [EVM_PAYTO], signers: [gasWallet.address] })
  return { app, writes }
}

/** Route merchant → facilitator traffic: Blocky402 (native) is mocked; the EVM facilitator is our real app. */
function stubFacilitators(evmApp?: ReturnType<typeof createFacilitatorApp>) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    calls.push(url)
    if (url.startsWith(EVM_FACILITATOR) && evmApp) return evmApp.request(new URL(url).pathname, init)
    if (url.endsWith('/supported')) {
      return new Response(JSON.stringify({ kinds: [{ x402Version: 2, scheme: 'exact', network: HEDERA_TESTNET_CAIP2, extra: { feePayer: '0.0.7162784' } }], extensions: [], signers: {} }), { status: 200 })
    }
    throw new Error(`Unexpected request ${url}`)
  }))
  return calls
}

async function accepts(app: ReturnType<typeof createApp>) {
  const unpaid = await app.request('/v1/market/quotes?symbols=BTC')
  expect(unpaid.status).toBe(402)
  return decodePaymentRequiredHeader(unpaid.headers.get('payment-required')!)
}

describe('EVM rail: fUSD on Hedera EVM via Finality facilitator (Step 14b)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is off by default: the 402 keeps exactly the native USDC and HBAR accepts', async () => {
    stubFacilitators()
    const required = await accepts(createApp(testEnv))
    expect(required.accepts.map((a) => a.asset).sort()).toEqual([HBAR_ASSET_ID, HEDERA_TESTNET_USDC].sort())
    expect(required.accepts.every((a) => a.network === HEDERA_TESTNET_CAIP2)).toBe(true)
  })

  it('adds a third fUSD accept on eip155:296 when configured, leaving native accepts unchanged', async () => {
    const { app: evmApp } = evmFacilitatorApp()
    stubFacilitators(evmApp)
    const required = await accepts(createApp(evmEnv))
    expect(required.accepts).toHaveLength(3)
    const native = required.accepts.filter((a) => a.network === HEDERA_TESTNET_CAIP2)
    expect(native.map((a) => a.asset).sort()).toEqual([HBAR_ASSET_ID, HEDERA_TESTNET_USDC].sort())
    expect(native.every((a) => a.payTo === testEnv.X402_PAYTO_ADDRESS)).toBe(true)
    const evm = required.accepts.find((a) => a.network === 'eip155:296')!
    expect(evm).toMatchObject({ scheme: 'exact', asset: fusd.address, amount: '150000', payTo: EVM_PAYTO })
    expect(evm.extra).toMatchObject({ name: 'Finality USD', version: '1' })
  })

  it('settles a MetaMask-style EIP-712 payment through our facilitator and logs an EVM sale to HCS', async () => {
    const { app: evmApp, writes } = evmFacilitatorApp()
    const calls = stubFacilitators(evmApp)
    const submitted: string[] = []
    const audit = new AuditPublisher('0.0.9001', async (_t, m) => { submitted.push(m); return { sequenceNumber: '1', transactionId: 'x' } }, { logger: () => {} })
    const app = createApp(evmEnv, { audit })

    const required = await accepts(app)
    const client = x402Client.fromConfig({
      schemes: [{ network: 'eip155:296', client: new ClientEvmScheme(toClientEvmSigner(payer)) }],
      spendControls: hederaSpendControls({ fusd }),
      paymentRequirementsSelector: (_v, reqs) => reqs.find((r) => r.network === 'eip155:296')!,
    })
    const payload = await client.createPaymentPayload(required)
    const paid = await app.request('/v1/market/quotes?symbols=BTC', { headers: { 'PAYMENT-SIGNATURE': encodePaymentSignatureHeader(payload) } })
    expect(paid.status).toBe(200)
    const bytes = Buffer.from(await paid.arrayBuffer())

    expect(calls.filter((u) => u.startsWith(EVM_FACILITATOR) && /\/(verify|settle)$/.test(u))).toHaveLength(2)
    expect(calls.some((u) => /blocky402.*\/(verify|settle)$/.test(u))).toBe(false)
    expect(writes).toHaveLength(1)

    await audit.flush()
    const sale = decodeAuditMessage(Buffer.from(submitted[0]).toString('base64'))
    expect(sale).toMatchObject({ type: 'sale', op: 'market.quotes', payTo: EVM_PAYTO, asset: fusd.address, network: 'eip155:296', tx: EVM_TX })
    expect(sale && 'sha256' in sale ? sale.sha256 : '').toBe(createHash('sha256').update(bytes).digest('hex'))
  })

  it('advertises the fUSD rail in /.well-known/x402 only when configured', () => {
    expect(wellKnownX402(discoveryContext(testEnv, 'http://x')).evm).toBeUndefined()
    const doc = wellKnownX402(discoveryContext(evmEnv, 'http://x'))
    expect(doc.evm).toMatchObject({ network: 'eip155:296', asset: fusd.address, facilitator: EVM_FACILITATOR, eip712: { name: 'Finality USD', version: '1' } })
    expect(doc.resources.some((r) => r.network === 'eip155:296' && r.asset === fusd.address)).toBe(true)
  })
})
