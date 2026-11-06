import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { PrivateKey } from '@hiero-ledger/sdk'
import { loadConfig } from './config.js'
import { createAccount, createClient, parsePrivateKey } from './hedera.js'
import { banner, log, msg, ok, warn } from './util.js'
import { normalizeAssociationFields } from './types.js'

export type FunderWalletRecord = {
  index: number
  accountId: string
  privateKey: string
  privateKeyDer: string
  privateKeyHex: string
  createdAt: string
  associatedUsdc?: boolean
  associateTxId?: string
}

export type FunderStore = {
  network: 'hedera-testnet' | 'hedera-mainnet'
  purpose: 'Finality x402 keeper funders (HBAR drip + USDC drop)'
  count: number
  createdAt: string
  updatedAt: string
  funders: FunderWalletRecord[]
}

const FUNDER_COUNT = 5

function fundersPath(dataDir = resolve(process.cwd(), 'data')): string {
  return resolve(dataDir, 'funders.json')
}

function envPath(): string {
  return resolve(process.cwd(), '.env')
}

/**
 * Generate 5 funder keypairs. If OPERATOR_ACCOUNT_ID + OPERATOR_PRIVATE_KEY are set,
 * creates on-chain accounts via AccountCreateTransaction. Otherwise stores keys with
 * empty accountId for you to fill from the Hedera portal / faucet.
 */
export async function createFunderWallets(force = false, writeEnv = true): Promise<FunderStore> {
  banner(`Create ${FUNDER_COUNT} funder wallets`)
  const config = loadConfig()
  const dataDir = resolve(process.cwd(), 'data')
  const target = fundersPath(dataDir)
  await mkdir(dataDir, { recursive: true })

  if (existsSync(target) && !force) {
    throw new Error(`Refusing to overwrite ${target}. Pass --force to regenerate.`)
  }

  const now = new Date().toISOString()
  const funders: FunderWalletRecord[] = []
  const operatorId = config.OPERATOR_ACCOUNT_ID.trim()
  const operatorKey = config.OPERATOR_PRIVATE_KEY.trim()
  const canCreate = Boolean(operatorId && operatorKey)

  let client = canCreate ? createClient(config, { accountId: operatorId, privateKey: operatorKey }) : null

  for (let i = 0; i < FUNDER_COUNT; i++) {
    const key = PrivateKey.generateECDSA()
    const privateKeyDer = key.toStringDer()
    const privateKeyHex = key.toStringRaw()
    let accountId = ''

    if (client && operatorId && operatorKey) {
      msg(`  creating on-chain funder #${i} via operator ${operatorId}…`)
      const created = await createAccount(
        client,
        { accountId: operatorId, privateKey: operatorKey },
        key.publicKey,
        10,
      )
      accountId = created.accountId
      ok(`funder #${i}  ${accountId}  (created tx=${created.txId})`)
    } else {
      warn(`funder #${i} key generated — set accountId after portal/faucet create`)
      ok(`funder #${i}  (pending accountId)`)
    }

    // Sanity: key round-trips
    parsePrivateKey(privateKeyDer)

    funders.push({
      index: i,
      accountId,
      privateKey: privateKeyDer,
      privateKeyDer,
      privateKeyHex,
      createdAt: now,
    })
    msg(`  privateKeyDer + privateKeyHex stored`)
  }

  client?.close()

  const store: FunderStore = {
    network: config.X402_NETWORK,
    purpose: 'Finality x402 keeper funders (HBAR drip + USDC drop)',
    count: funders.length,
    createdAt: now,
    updatedAt: now,
    funders,
  }

  await writeFile(target, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 })
  await chmod(target, 0o600)
  ok(`wrote ${funders.length} funders → ${target} (mode 600)`)
  log('funders.created', { count: funders.length, path: target, onChain: canCreate })

  if (writeEnv) {
    await patchEnvWithFunders(funders)
  }

  if (!canCreate) {
    msg('Set OPERATOR_ACCOUNT_ID + OPERATOR_PRIVATE_KEY to auto-create accounts next time,')
    msg('or paste portal account ids into FUNDER_*_ACCOUNT_ID in .env / data/funders.json')
  }
  msg(`next: fund each account with testnet HBAR + associate USDC ${config.USDC_TOKEN_ID}, then npm run fund`)
  for (const f of funders) {
    console.log(`  FUNDER_${f.index + 1}_ACCOUNT_ID=${f.accountId || ''}`)
  }

  return store
}

async function patchEnvWithFunders(funders: FunderWalletRecord[]): Promise<void> {
  const target = envPath()
  let source = existsSync(target)
    ? await readFile(target, 'utf8')
    : existsSync(resolve(process.cwd(), '.env.example'))
      ? await readFile(resolve(process.cwd(), '.env.example'), 'utf8')
      : ''

  const entries: Record<string, string> = {}
  for (const f of funders) {
    entries[`FUNDER_${f.index + 1}_PRIVATE_KEY`] = f.privateKey
    entries[`FUNDER_${f.index + 1}_ACCOUNT_ID`] = f.accountId
  }

  let output = source
  for (const [key, value] of Object.entries(entries)) {
    const line = `${key}=${value}`
    const pattern = new RegExp(`^${key}=.*$`, 'm')
    output = pattern.test(output) ? output.replace(pattern, line) : `${output.trimEnd()}\n${line}\n`
  }

  await writeFile(target, output, { encoding: 'utf8', mode: 0o600 })
  await chmod(target, 0o600)
  ok(`patched FUNDER_1…5_ACCOUNT_ID (+ PRIVATE_KEY) into ${target}`)
  warn('never commit .env or data/funders.json — they hold real private keys')
}

export async function loadFunderStore(): Promise<FunderStore> {
  const target = fundersPath()
  if (!existsSync(target)) {
    throw new Error(`Missing ${target}. Run: npm run funders`)
  }
  const store = JSON.parse(await readFile(target, 'utf8')) as FunderStore
  store.funders.forEach(normalizeAssociationFields)
  return store
}

export async function saveFunderStore(store: FunderStore): Promise<void> {
  const target = fundersPath()
  store.updatedAt = new Date().toISOString()
  store.count = store.funders.length
  await writeFile(target, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 })
  await chmod(target, 0o600)
}
