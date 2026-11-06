/**
 * Deploy Finality USD (fUSD, EIP-3009 test dollar) to Hedera EVM and mint it to test wallets.
 *
 *   npm run fusd:compile
 *   npm run fusd:deploy -- 0xMetaMask... 0xAgent...      # deploy once, then mint 100 fUSD to each address
 *   npm run fusd:deploy -- --amount 25 0xAddr...          # re-run: only mints (deployment file already exists)
 *
 * The deployer and owner is MERCHANT_OPERATOR_KEY (ECDSA; its EVM alias pays gas in HBAR). The address is written to
 * contracts/deployments/<network>.json, which the merchant, facilitator and browser read.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { createPublicClient, createWalletClient, getAddress, http, parseUnits, type Abi, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { hedera, hederaTestnet } from 'viem/chains'
import { toViemPrivateKey } from '../lib/evm/erc8004'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

function env(name: string) {
  const v = process.env[name]?.trim()
  return v ? v : undefined
}

async function main() {
  const network = env('X402_NETWORK') ?? 'hedera-testnet'
  const chain = network === 'hedera-mainnet' ? hedera : hederaTestnet
  const key = env('MERCHANT_OPERATOR_KEY')
  if (!key) throw new Error('Set MERCHANT_OPERATOR_KEY (ECDSA) in .env')

  const args = process.argv.slice(2)
  let amount = '100'
  const recipients: `0x${string}`[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--amount') amount = args[++i]
    else recipients.push(getAddress(args[i]))
  }

  const artifact = JSON.parse(readFileSync(path.join(root, 'contracts/artifacts/FinalityUSD.json'), 'utf8')) as { abi: Abi; bytecode: Hex }
  const account = privateKeyToAccount(toViemPrivateKey(key))
  const transport = http(env('EVM_RPC_URL'))
  const publicClient = createPublicClient({ chain, transport })
  const wallet = createWalletClient({ account, chain, transport })

  const deploymentsDir = path.join(root, 'contracts/deployments')
  const deploymentFile = path.join(deploymentsDir, `${network}.json`)
  let address: `0x${string}`
  if (existsSync(deploymentFile)) {
    address = getAddress(JSON.parse(readFileSync(deploymentFile, 'utf8')).fusd.address)
    console.log(`fUSD already deployed at ${address}`)
  } else {
    console.log(`Deploying fUSD from ${account.address} on chain ${chain.id}…`)
    const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args: [account.address] })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`Deploy failed: ${hash}`)
    address = getAddress(receipt.contractAddress)
    mkdirSync(deploymentsDir, { recursive: true })
    writeFileSync(
      deploymentFile,
      JSON.stringify(
        {
          network,
          caip2: `eip155:${chain.id}`,
          fusd: { address, name: 'Finality USD', symbol: 'fUSD', version: '1', decimals: 6, owner: account.address, deployTx: hash, block: Number(receipt.blockNumber) },
        },
        null,
        2,
      ) + '\n',
    )
    console.log(`Deployed fUSD at ${address} (tx ${hash})`)
  }

  for (const to of recipients) {
    const hash = await wallet.writeContract({ address, abi: artifact.abi, functionName: 'mint', args: [to, parseUnits(amount, 6)] })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    console.log(`Minted ${amount} fUSD to ${to}: ${receipt.status} (tx ${hash})`)
  }

  const [name, version, decimals] = await Promise.all(
    (['name', 'version', 'decimals'] as const).map((functionName) => publicClient.readContract({ address, abi: artifact.abi, functionName })),
  )
  console.log(`On-chain: name=${name} version=${version} decimals=${decimals}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
