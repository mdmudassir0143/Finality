/**
 * Finality EVM facilitator: settles x402 `exact` (EIP-3009) payments in fUSD on Hedera EVM and pays the gas.
 *
 *   npm run dev:facilitator     # http://localhost:4022
 *
 * Env (root .env):
 *   FACILITATOR_EVM_KEY          dedicated ECDSA key holding HBAR for gas (NOT the merchant or operator key)
 *   FACILITATOR_PORT             default 4022
 *   X402_EVM_PAYTO_ADDRESS       merchant EVM payee; the only recipient this facilitator pays gas for
 *   FUSD_ADDRESS                 optional override of contracts/deployments/<network>.json
 *   X402_NETWORK, EVM_RPC_URL    network label and optional RPC (default Hashio)
 *
 * The hosted Blocky402 facilitator keeps settling native HBAR / HTS USDC; this service only handles eip155.
 */
import { config } from 'dotenv'
import { serve } from '@hono/node-server'
import { x402Facilitator } from '@x402/core/facilitator'
import { ExactEvmScheme } from '@x402/evm/exact/facilitator'
import { toFacilitatorEvmSigner } from '@x402/evm'
import { createPublicClient, createWalletClient, http, publicActions } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { hedera, hederaTestnet } from 'viem/chains'
import { toViemPrivateKey } from '../lib/evm/erc8004'
import { fusdConfig } from '../lib/evm/fusd'
import { createFacilitatorApp } from './app'

config({ path: 'facilitator/.env' })
config({ path: '.env' })

function env(name: string) {
  const v = process.env[name]?.trim()
  return v ? v : undefined
}

const network = env('X402_NETWORK') ?? 'hedera-testnet'
const chain = network === 'hedera-mainnet' ? hedera : hederaTestnet
const fusd = fusdConfig(network, env('FUSD_ADDRESS'))
if (!fusd) throw new Error(`fUSD is not deployed on ${network} (npm run fusd:deploy) and FUSD_ADDRESS is unset`)
const key = env('FACILITATOR_EVM_KEY')
if (!key) throw new Error('Set FACILITATOR_EVM_KEY (dedicated ECDSA gas wallet, funded with HBAR)')
for (const forbidden of ['MERCHANT_OPERATOR_KEY', 'X402_TEST_PAYER_PRIVATE_KEY']) {
  if (env(forbidden) && toViemPrivateKey(env(forbidden)!) === toViemPrivateKey(key)) {
    throw new Error(`FACILITATOR_EVM_KEY must be a dedicated key, not ${forbidden}`)
  }
}
const payTo = env('X402_EVM_PAYTO_ADDRESS')
if (!payTo) throw new Error('Set X402_EVM_PAYTO_ADDRESS (merchant EVM payee) so the facilitator only pays gas for Finality')

const account = privateKeyToAccount(toViemPrivateKey(key))
const transport = http(env('EVM_RPC_URL'))
const client = createWalletClient({ account, chain, transport }).extend(publicActions)
const reader = createPublicClient({ chain, transport })

const signer = toFacilitatorEvmSigner({
  address: account.address,
  readContract: (args) => reader.readContract(args as Parameters<typeof reader.readContract>[0]),
  verifyTypedData: (args) => reader.verifyTypedData(args as Parameters<typeof reader.verifyTypedData>[0]),
  writeContract: (args) => client.writeContract({ ...(args as Parameters<typeof client.writeContract>[0]), account, chain }),
  sendTransaction: (args) => client.sendTransaction({ ...args, account, chain }),
  waitForTransactionReceipt: (args) => reader.waitForTransactionReceipt(args),
  getCode: (args) => reader.getCode(args),
})

const core = new x402Facilitator().register(fusd.network as `${string}:${string}`, new ExactEvmScheme(signer, { simulateInSettle: true }))
core.onAfterSettle(async ({ result }) => {
  console.log(JSON.stringify({ level: 'info', message: 'settled', network: result.network, tx: result.transaction, payer: result.payer, success: result.success }))
})

const app = createFacilitatorApp(core, {
  networks: [fusd.network],
  allowedAssets: [fusd.address],
  allowedPayTo: [payTo],
  signers: [account.address],
})

const port = Number(env('FACILITATOR_PORT') ?? 4022)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(JSON.stringify({ level: 'info', message: 'Finality EVM facilitator listening', port: info.port, network: fusd.network, asset: fusd.address, signer: account.address }))
})
