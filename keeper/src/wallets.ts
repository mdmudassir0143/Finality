import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { PrivateKey } from '@hiero-ledger/sdk'
import type { KeeperConfig } from './config.js'
import { normalizeAssociationFields, type FunderAccount, type KeeperWallet, type WalletStore } from './types.js'
import { parsePrivateKey } from './hedera.js'
import { banner, log, msg, ok } from './util.js'

export async function createWallets(config: KeeperConfig, force = false): Promise<WalletStore> {
  banner(`Create ${config.WALLET_COUNT} wallets`)
  await mkdir(config.dataDir, { recursive: true })
  if (existsSync(config.walletsPath) && !force) {
    throw new Error(
      `Refusing to overwrite ${config.walletsPath}. Delete it or pass --force to regenerate.`,
    )
  }

  msg(`generating ${config.WALLET_COUNT} Hedera ECDSA keypairs (account ids assigned on fund)…`)
  const now = new Date().toISOString()
  const wallets: KeeperWallet[] = []
  for (let i = 0; i < config.WALLET_COUNT; i++) {
    const key = PrivateKey.generateECDSA()
    wallets.push({
      index: i,
      accountId: '',
      privateKey: key.toStringDer(),
      createdAt: now,
    })
    if ((i + 1) % 10 === 0 || i === 0) {
      msg(`  created ${i + 1}/${config.WALLET_COUNT}`)
    }
  }

  const store: WalletStore = {
    network: config.X402_NETWORK,
    count: wallets.length,
    createdAt: now,
    updatedAt: now,
    wallets,
  }
  await saveWallets(config, store)
  ok(`wrote ${wallets.length} wallets → ${config.walletsPath} (mode 600)`)
  msg(`next: npm run fund   (creates accounts + HBAR drip + USDC associate/drop)`)
  log('wallets.created', { count: wallets.length, path: config.walletsPath })
  return store
}

export async function loadWallets(config: KeeperConfig): Promise<WalletStore> {
  if (!existsSync(config.walletsPath)) {
    throw new Error(`Missing ${config.walletsPath}. Run: npm run wallets`)
  }
  const raw = JSON.parse(await readFile(config.walletsPath, 'utf8')) as WalletStore
  if (!Array.isArray(raw.wallets) || raw.wallets.length === 0) {
    throw new Error(`No wallets found in ${config.walletsPath}`)
  }
  raw.wallets.forEach(normalizeAssociationFields)
  return raw
}

export async function saveWallets(config: KeeperConfig, store: WalletStore): Promise<void> {
  store.updatedAt = new Date().toISOString()
  store.count = store.wallets.length
  await writeFile(config.walletsPath, JSON.stringify(store, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  })
  await chmod(config.walletsPath, 0o600)
}

export function loadFunders(config: KeeperConfig): FunderAccount[] {
  const rows: Array<{ accountId: string; privateKey: string }> = [
    { accountId: config.FUNDER_1_ACCOUNT_ID, privateKey: config.FUNDER_1_PRIVATE_KEY },
    { accountId: config.FUNDER_2_ACCOUNT_ID, privateKey: config.FUNDER_2_PRIVATE_KEY },
    { accountId: config.FUNDER_3_ACCOUNT_ID, privateKey: config.FUNDER_3_PRIVATE_KEY },
    { accountId: config.FUNDER_4_ACCOUNT_ID, privateKey: config.FUNDER_4_PRIVATE_KEY },
    { accountId: config.FUNDER_5_ACCOUNT_ID, privateKey: config.FUNDER_5_PRIVATE_KEY },
  ]
  return rows.map((row, index) => {
    const accountId = row.accountId.trim()
    const privateKey = row.privateKey.trim()
    // Validate key parses; account id format is checked lightly.
    parsePrivateKey(privateKey)
    if (!/^0\.0\.\d+$/.test(accountId)) {
      throw new Error(`Funder #${index} account id looks invalid: ${accountId}`)
    }
    return { index, accountId, privateKey }
  })
}

/** Resolve private key for a keeper wallet (validates parse). */
export function keyFromWallet(wallet: KeeperWallet): PrivateKey {
  return parsePrivateKey(wallet.privateKey)
}
