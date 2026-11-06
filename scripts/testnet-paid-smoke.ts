/**
 * Hedera paid smoke: a private-key payer (no human approval) settles real x402 payments
 * through Blocky402, once in USDC and once in HBAR, then records the evidence.
 *
 * Requires in .env:
 *   X402_TEST_PAYER_ACCOUNT_ID=0.0.x      payer with HBAR, associated with USDC and holding USDC
 *   X402_TEST_PAYER_PRIVATE_KEY=...
 *   X402_PAYTO_ADDRESS=0.0.x              merchant treasury (USDC-associated for USDC payments)
 *   X402_FACILITATOR_URL=https://api.testnet.blocky402.com
 * Optional:
 *   X402_SMOKE_BASE_URL   merchant origin (default X402_SERVER_URL, else http://localhost:4021)
 *   X402_SMOKE_PATH       paid GET route (default /v1/onchain/hedera/network/supply)
 *   X402_SMOKE_ASSETS     comma list of USDC,HBAR (default both)
 *   X402_SMOKE_RECORD=0   skip appending to docs/SETTLEMENTS.md
 */
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { PrivateKey } from '@hiero-ledger/sdk'
import { x402Client } from '@x402/core/client'
import { decodePaymentResponseHeader, wrapFetchWithPayment } from '@x402/fetch'
import {
  ExactHederaScheme,
  HBAR_ASSET_ID,
  HEDERA_MAINNET_CAIP2,
  HEDERA_TESTNET_CAIP2,
  createClientHederaSigner,
} from '@x402/hedera'
import { toMirrorTransactionId } from '../lib/onchain/hedera/mirror'
import { hederaSpendControls } from '../lib/x402/spend'
import { parseHederaPrivateKey } from '../lib/hedera/keys'

type Asset = 'USDC' | 'HBAR'

const SETTLEMENTS_PATH = 'docs/SETTLEMENTS.md'
const SETTLEMENTS_HEADER = `# Settled x402 payments on Hedera

Evidence of real x402 payments settled through Blocky402. Each row is written by
\`npm run test:x402:testnet\` (\`scripts/testnet-paid-smoke.ts\`) after the Mirror Node confirms the transaction.

| Date (UTC) | Network | Asset | Amount | Route | Payer | Transaction ID | Result | HashScan |
|---|---|---|---|---|---|---|---|---|
`

function env(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

const isMainnet = (env('X402_NETWORK') ?? 'hedera-testnet').includes('mainnet')
const caip2 = isMainnet ? HEDERA_MAINNET_CAIP2 : HEDERA_TESTNET_CAIP2
const networkSlug = isMainnet ? 'mainnet' : 'testnet'
const mirrorBase = (env('MIRROR_NODE_URL') ??
  (isMainnet ? 'https://mainnet-public.mirrornode.hedera.com' : 'https://testnet.mirrornode.hedera.com')).replace(/\/$/, '')

function formatAmount(asset: Asset, amount: string): string {
  const n = Number(amount)
  return asset === 'HBAR' ? `${n / 1e8} HBAR (${amount} tinybars)` : `${n / 1e6} USDC`
}

/** Poll the Mirror Node until the settled transaction is visible (ingest lag is a few seconds). */
async function confirmOnMirror(transactionId: string) {
  const mirrorId = toMirrorTransactionId(transactionId)
  for (let attempt = 0; attempt < 15; attempt++) {
    const response = await fetch(`${mirrorBase}/api/v1/transactions/${mirrorId}`)
    if (response.ok) {
      const body = (await response.json()) as { transactions?: Array<{ result: string; consensus_timestamp: string }> }
      const tx = body.transactions?.[0]
      if (tx) return { result: tx.result, consensusTimestamp: tx.consensus_timestamp }
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  throw new Error(`Transaction ${transactionId} not visible on the Mirror Node after 30s`)
}

async function payOnce(asset: Asset, base: string, path: string, accountId: string, key: PrivateKey) {
  const signer = createClientHederaSigner(accountId, key, { network: caip2 })
  let chosen: { amount: string; asset: string } | undefined
  const client = x402Client.fromConfig({
    schemes: [{ network: caip2, client: new ExactHederaScheme(signer) }],
    spendControls: hederaSpendControls(),
    paymentRequirementsSelector: (_version, requirements) => {
      const match = requirements.find((r) =>
        asset === 'HBAR' ? r.asset === HBAR_ASSET_ID : r.asset !== HBAR_ASSET_ID,
      )
      if (!match) throw new Error(`Merchant did not offer ${asset}`)
      chosen = { amount: match.amount, asset: match.asset }
      return match
    },
  })
  const paidFetch = wrapFetchWithPayment(globalThis.fetch, client)
  const url = `${base}${path}`
  console.log(`\n[${asset}] GET ${url}`)
  const response = await paidFetch(url)
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  console.log(`[${asset}] status ${response.status}`)
  if (!response.ok) {
    console.error(JSON.stringify(body, null, 2).slice(0, 1500))
    throw new Error(`[${asset}] paid request failed with HTTP ${response.status}`)
  }
  const header = response.headers.get('PAYMENT-RESPONSE') ?? response.headers.get('Payment-Response')
  if (!header) throw new Error(`[${asset}] response has no PAYMENT-RESPONSE header`)
  const receipt = decodePaymentResponseHeader(header)
  if (!receipt.success || !receipt.transaction) {
    throw new Error(`[${asset}] settlement failed: ${JSON.stringify(receipt)}`)
  }
  const mirror = await confirmOnMirror(receipt.transaction)
  const hashscan = `https://hashscan.io/${networkSlug}/transaction/${mirror.consensusTimestamp}`
  console.log(`[${asset}] settled tx ${receipt.transaction} → ${mirror.result}`)
  console.log(`[${asset}] HashScan ${hashscan}`)
  return {
    asset,
    path,
    payer: receipt.payer ?? accountId,
    transactionId: receipt.transaction,
    amount: chosen ? formatAmount(asset, chosen.amount) : 'see 402',
    result: mirror.result,
    hashscan,
  }
}

async function record(rows: Awaited<ReturnType<typeof payOnce>>[]) {
  if (!existsSync(SETTLEMENTS_PATH)) await writeFile(SETTLEMENTS_PATH, SETTLEMENTS_HEADER)
  else if (!(await readFile(SETTLEMENTS_PATH, 'utf8')).includes('| Date (UTC) |')) {
    await appendFile(SETTLEMENTS_PATH, `\n${SETTLEMENTS_HEADER}`)
  }
  const date = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const lines = rows.map((r) =>
    `| ${date} | Hedera ${networkSlug} | ${r.asset} | ${r.amount} | \`${r.path}\` | ${r.payer} | \`${r.transactionId}\` | ${r.result} | [view](${r.hashscan}) |`,
  )
  await appendFile(SETTLEMENTS_PATH, `${lines.join('\n')}\n`)
  console.log(`\nRecorded ${rows.length} settlement(s) in ${SETTLEMENTS_PATH}`)
}

async function main() {
  const accountId = env('X402_TEST_PAYER_ACCOUNT_ID')
  const privateKeyRaw = env('X402_TEST_PAYER_PRIVATE_KEY')
  if (!accountId || !privateKeyRaw) {
    throw new Error('Set X402_TEST_PAYER_ACCOUNT_ID and X402_TEST_PAYER_PRIVATE_KEY')
  }
  const base = (env('X402_SMOKE_BASE_URL') ?? env('X402_SERVER_URL') ?? 'http://localhost:4021').replace(/\/$/, '')
  const path = env('X402_SMOKE_PATH') ?? '/v1/onchain/hedera/network/supply'
  const assets = (env('X402_SMOKE_ASSETS') ?? 'USDC,HBAR')
    .split(',')
    .map((a) => a.trim().toUpperCase())
    .filter((a): a is Asset => a === 'USDC' || a === 'HBAR')

  // Raw hex is ambiguous: PrivateKey.fromString assumes ED25519. Portal x402 payers are usually ECDSA.
  const key = parseHederaPrivateKey(privateKeyRaw)
  const rows = []
  for (const asset of assets) rows.push(await payOnce(asset, base, path, accountId, key))
  if (env('X402_SMOKE_RECORD') !== '0') await record(rows)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
