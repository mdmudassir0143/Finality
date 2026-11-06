/**
 * Live smoke for the EVM rail (Step 14b): pay a Finality endpoint in fUSD on Hedera EVM, MetaMask-style.
 *
 *   npm run test:x402:evm                     # merchant (:4021) and facilitator (:4022) running, rail enabled
 *
 * The payer is an injected EIP-1193 provider backed by X402_TEST_PAYER_PRIVATE_KEY (the agent), so the exact path a
 * browser wallet takes is exercised: the provider answers eth_signTypedData_v4 and nothing else is sent from it.
 * The payer needs fUSD (npm run fusd:deploy -- <address>) but no HBAR. Each run settles one real testnet payment.
 * Env: X402_SMOKE_BASE_URL (default http://localhost:4021), X402_SMOKE_PATH (default /v1/market/quotes?symbols=BTC).
 */
import { createWalletClient, custom, type EIP1193RequestFn } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { hederaTestnet } from 'viem/chains'
import { decodePaymentResponseHeader } from '@x402/core/http'
import { toViemPrivateKey } from '../lib/evm/erc8004'
import { fusdConfig } from '../lib/evm/fusd'
import { evmSignerFromWallet, readFusdBalance } from '../lib/evm/fusd-client'
import { createEvmPaidFetch } from '../lib/x402/client'

async function main() {
  const base = (process.env.X402_SMOKE_BASE_URL ?? 'http://localhost:4021').replace(/\/$/, '')
  const path = process.env.X402_SMOKE_PATH ?? '/v1/market/quotes?symbols=BTC'
  const fusd = fusdConfig(process.env.X402_NETWORK ?? 'hedera-testnet')
  if (!fusd) throw new Error('fUSD is not deployed on this network')
  const key = process.env.X402_TEST_PAYER_PRIVATE_KEY
  if (!key) throw new Error('Set X402_TEST_PAYER_PRIVATE_KEY')
  const account = privateKeyToAccount(toViemPrivateKey(key))

  // Minimal injected provider, like window.ethereum: only accounts, chain id and typed-data signing.
  const methods: string[] = []
  const request = (async ({ method, params }: { method: string; params?: unknown[] }) => {
    methods.push(method)
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account.address]
    if (method === 'eth_chainId') return `0x${fusd.chainId.toString(16)}`
    if (method === 'eth_signTypedData_v4') {
      const [, json] = params as [string, string]
      const typed = JSON.parse(json)
      delete typed.types.EIP712Domain
      return account.signTypedData(typed)
    }
    throw new Error(`Injected provider: ${method} not supported`)
  }) as EIP1193RequestFn
  const wallet = createWalletClient({ account: account.address, chain: hederaTestnet, transport: custom({ request }) })

  const before = await readFusdBalance(fusd, account.address)
  const states: string[] = []
  // Same client the browser uses (lib/x402/client.ts); the browser goes through the Next proxy, this hits the merchant.
  const response = await createEvmPaidFetch(evmSignerFromWallet(wallet), (s) => states.push(s))(`${base}${path}`, { method: 'GET' })
  const body = await response.json()
  const receipt = response.headers.get('payment-response')
  const settlement = receipt ? decodePaymentResponseHeader(receipt) : null
  const after = await readFusdBalance(fusd, account.address)

  console.log(JSON.stringify({ payer: account.address, path, states, operationId: body?.operationId, settlement, fusd: { before, after }, providerMethods: [...new Set(methods)] }, null, 2))
  if (!settlement?.success || settlement.network !== fusd.network) throw new Error('fUSD settlement missing')
  if (methods.some((m) => m.startsWith('eth_send'))) throw new Error('The payer wallet sent a transaction; it should only sign')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
