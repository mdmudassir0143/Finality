/**
 * Finality research agent — an autonomous x402 buyer on Hedera.
 *
 *   npm run agent -- --goal "HBAR market + network health brief" --budget 1.00
 *
 * Options:
 *   --goal "<text>"          what to research (required)
 *   --budget <usd>           total budget for this run (default 1.00)
 *   --max-call <usd>         per-call cap (default 0.50)
 *   --per-merchant <usd>     cap per merchant (default = budget)
 *   --approve-above <usd>    ask a human above this cost (default 0.25)
 *   --asset HBAR|USDC        settlement asset (default HBAR)
 *   --merchant <url>         merchant origin (default X402_SERVER_URL or http://localhost:4021)
 *   --only op1,op2           restrict the plan to these operation ids
 *   --max-calls <n>          max calls in the plan (default 4)
 *   --allow-payto 0.0.a,…    explicit payTo allowlist (default: the payTo the merchant advertises)
 *   --no-identity            do not require a verified ERC-8004 merchant identity
 *   --yes                    auto-approve above the threshold;  --no-interactive  auto-decline instead
 *   --no-audit / --no-feedback   disable HCS spend records / ERC-8004 feedback
 *   --record                 append the run to docs/AGENT_RUNS.md
 *
 * Env (.env): X402_TEST_PAYER_ACCOUNT_ID / X402_TEST_PAYER_PRIVATE_KEY (the agent's ECDSA key: Hedera payer and
 * ERC-8004 owner), ERC8004_AGENT_ID, HCS_AUDIT_TOPIC_ID, X402_NETWORK.
 */
import { appendFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { HEDERA_MAINNET_CAIP2, HEDERA_TESTNET_CAIP2, createClientHederaSigner } from '@x402/hedera'
import { agentRegistryId, erc8004Config, giveFeedback, readAgent, type Erc8004Network } from '../lib/evm/erc8004'
import { AuditPublisher, createOperatorClient, sdkSubmitter } from '../lib/hedera/hcs'
import { parseHederaPrivateKey } from '../lib/hedera/keys'
import { runAgent, type Asset, type RunReport } from './src/run'

function args(argv: string[]) {
  const out: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next
      i++
    } else out[key] = true
  }
  return out
}

const env = (name: string) => process.env[name]?.trim() || undefined
const num = (v: string | boolean | undefined, d: number) => (typeof v === 'string' && Number.isFinite(Number(v)) ? Number(v) : d)

function hashscan(slug: string, kind: 'transaction' | 'topic', id: string) {
  if (kind === 'transaction' && id.includes('@')) {
    const [acct, ts] = id.split('@')
    return `https://hashscan.io/${slug}/transaction/${acct}-${ts.replace('.', '-')}`
  }
  return `https://hashscan.io/${slug}/${kind}/${id}`
}

function printReport(report: RunReport, slug: string) {
  console.log('\n=== Run report ===')
  console.log(`Goal: ${report.goal}`)
  console.log(`Merchant: ${report.merchant}` + (report.merchantIdentity ? ` (ERC-8004 #${report.merchantIdentity.agentId}, ${report.identityVerified ? 'verified' : 'unverified'})` : ''))
  for (const r of report.results) {
    console.log(`- ${r.operationId}  $${r.usd}  ${r.decision.toUpperCase()}  ${r.reason}`)
    if (r.paymentTx) console.log(`    payment  ${hashscan(slug, 'transaction', r.paymentTx)}`)
    if (r.feedbackTx) console.log(`    feedback https://hashscan.io/${slug}/transaction/${r.feedbackTx}`)
    if (r.sha256) console.log(`    data sha256 ${r.sha256}`)
    if (r.summary) console.log(`    data ${r.summary}`)
  }
  console.log(`Spent $${report.spentUsd}, budget left $${report.remainingUsd}`)
}

async function record(report: RunReport, slug: string, auditTopic?: string) {
  const lines = [
    `\n## ${new Date().toISOString()} — "${report.goal}"`,
    '',
    `Merchant ${report.merchant}${report.merchantIdentity ? ` (ERC-8004 #${report.merchantIdentity.agentId}, ${report.identityVerified ? 'verified' : 'unverified'})` : ''}. Spent $${report.spentUsd}, budget left $${report.remainingUsd}.${auditTopic ? ` Audit topic [${auditTopic}](https://hashscan.io/${slug}/topic/${auditTopic}).` : ''}`,
    '',
    '| Operation | USD | Decision | Reason | Payment | ERC-8004 feedback |',
    '|---|---|---|---|---|---|',
    ...report.results.map(
      (r) =>
        `| \`${r.operationId}\` | ${r.usd} | ${r.decision} | ${r.reason} | ${r.paymentTx ? `[${r.paymentTx}](${hashscan(slug, 'transaction', r.paymentTx)})` : '—'} | ${r.feedbackTx ? `[tx](https://hashscan.io/${slug}/transaction/${r.feedbackTx})` : '—'} |`,
    ),
    '',
  ]
  await appendFile('docs/AGENT_RUNS.md', lines.join('\n'))
  console.log('Recorded in docs/AGENT_RUNS.md')
}

async function main() {
  const a = args(process.argv.slice(2))
  const goal = typeof a.goal === 'string' ? a.goal : ''
  if (!goal) throw new Error('Usage: npm run agent -- --goal "<what to research>" [--budget 1.00]')
  const accountId = env('X402_TEST_PAYER_ACCOUNT_ID')
  const key = env('X402_TEST_PAYER_PRIVATE_KEY')
  if (!accountId || !key) throw new Error('Set X402_TEST_PAYER_ACCOUNT_ID and X402_TEST_PAYER_PRIVATE_KEY (the agent account)')

  const network = (env('X402_NETWORK') ?? 'hedera-testnet') as Erc8004Network
  const slug = network === 'hedera-mainnet' ? 'mainnet' : 'testnet'
  const caip2 = network === 'hedera-mainnet' ? HEDERA_MAINNET_CAIP2 : HEDERA_TESTNET_CAIP2
  const merchant = (typeof a.merchant === 'string' ? a.merchant : env('X402_SERVER_URL') ?? 'http://localhost:4021').replace(/\/$/, '')
  const budget = num(a.budget, 1)
  const evm = erc8004Config(network, { rpcUrl: env('EVM_RPC_URL'), identityRegistry: env('ERC8004_IDENTITY_REGISTRY'), reputationRegistry: env('ERC8004_REPUTATION_REGISTRY') })
  const agentId = env('ERC8004_AGENT_ID')
  const agentLabel = evm && agentId ? `${agentRegistryId(evm)}#${agentId}` : `hedera:${slug}:${accountId}`

  const auditTopic = env('HCS_AUDIT_TOPIC_ID')
  const hcsClient = a['no-audit'] || !auditTopic ? null : createOperatorClient({ network, operatorId: accountId, operatorKey: key })
  const audit = hcsClient && auditTopic ? new AuditPublisher(auditTopic, sdkSubmitter(hcsClient), { logger: () => {} }) : null

  const rl = a.yes || a['no-interactive'] ? null : createInterface({ input: process.stdin, output: process.stdout })
  console.log(`Agent ${agentLabel} (Hedera ${accountId}) — budget $${budget}`)
  try {
    const report = await runAgent(
      {
        merchant,
        goal,
        asset: (typeof a.asset === 'string' && a.asset.toUpperCase() === 'USDC' ? 'USDC' : 'HBAR') as Asset,
        maxCalls: num(a['max-calls'], 4),
        only: typeof a.only === 'string' ? a.only.split(',').map((s) => s.trim()) : undefined,
        policy: {
          budgetUsd: budget,
          maxPerCallUsd: num(a['max-call'], 0.5),
          perMerchantUsd: num(a['per-merchant'], budget),
          approvalAboveUsd: num(a['approve-above'], 0.25),
          allowedPayTo: typeof a['allow-payto'] === 'string' ? a['allow-payto'].split(',').map((s) => s.trim()) : [],
          requireIdentity: !a['no-identity'],
        },
      },
      {
        fetch: globalThis.fetch,
        signer: createClientHederaSigner(accountId, parseHederaPrivateKey(key), { network: caip2 }),
        caip2,
        agentLabel,
        readIdentity: evm ? async (identity) => readAgent(evm, BigInt(identity.agentId)) : undefined,
        audit,
        feedback: evm && !a['no-feedback'] ? async (input) => giveFeedback(evm, key, input) : undefined,
        approve: async (question) => {
          if (a.yes) return true
          if (!rl) return false
          const answer = await rl.question(`  ? ${question} [y/N] `)
          return /^y(es)?$/i.test(answer.trim())
        },
        log: (line) => console.log(line),
      },
    )
    printReport(report, slug)
    if (audit) console.log(`HCS audit: ${audit.published.length} record(s) written, ${audit.failures} failed → https://hashscan.io/${slug}/topic/${auditTopic}`)
    if (a.record) await record(report, slug, auditTopic)
  } finally {
    rl?.close()
    hcsClient?.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
