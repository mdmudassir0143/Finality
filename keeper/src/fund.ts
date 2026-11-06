import { AccountId } from '@hiero-ledger/sdk'
import type { KeeperConfig } from './config.js'
import {
  accountBalances,
  createAccount,
  createClient,
  parsePrivateKey,
  sendHbar,
  sendUsdc,
} from './hedera.js'
import { loadFunderStore, saveFunderStore } from './create-funders.js'
import { associateFunderToUsdc, associateWalletToUsdc } from './associate.js'
import { banner, log, msg, ok, randomInt, shuffle, sleep, toBaseUnits, warn } from './util.js'
import { keyFromWallet, loadFunders, loadWallets, saveWallets } from './wallets.js'
import type { FunderAccount, KeeperWallet, WalletStore } from './types.js'

/** Skip HBAR/USDC drips when the keeper wallet already holds more than this much USDC. */
const SKIP_DRIP_IF_USDC_GT = 0.0

/** Prefer a random funder that can cover `need`; throws if none can. */
async function pickFunderWithBalance(
  config: KeeperConfig,
  funders: FunderAccount[],
  need: { hbar?: number; usdc?: number },
): Promise<FunderAccount> {
  const order = shuffle([...funders])
  for (const funder of order) {
    const bal = await accountBalances(config, funder.accountId, config.USDC_TOKEN_ID)
    if (need.hbar !== undefined && bal.hbar < need.hbar) continue
    if (need.usdc !== undefined && bal.usdc < need.usdc) continue
    return funder
  }
  const parts = [
    need.hbar !== undefined ? `${need.hbar} HBAR` : null,
    need.usdc !== undefined ? `${need.usdc} USDC` : null,
  ].filter(Boolean)
  throw new Error(`No funder has enough balance for ${parts.join(' + ')}`)
}

async function assertFunderReady(
  config: KeeperConfig,
  funder: FunderAccount,
  walletsToFund: number,
): Promise<void> {
  const bal = await accountBalances(config, funder.accountId, config.USDC_TOKEN_ID)
  const hbarNeeded = config.HBAR_DRIP_AMOUNT * Math.ceil(walletsToFund / 5) + 1
  msg(
    `funder #${funder.index} ${funder.accountId}  HBAR=${bal.hbar}  USDC=${bal.usdc}  associated=${bal.associatedUsdc}  (~${hbarNeeded} HBAR needed)`,
  )
  log('funder.status', {
    index: funder.index,
    accountId: funder.accountId,
    hbar: bal.hbar,
    usdc: bal.usdc,
    associatedUsdc: bal.associatedUsdc,
    hbarNeededApprox: hbarNeeded,
  })
  if (bal.hbar <= 0) {
    throw new Error(`Funder #${funder.index} ${funder.accountId} has no HBAR`)
  }
  if (!bal.associatedUsdc) {
    throw new Error(
      `Funder #${funder.index} ${funder.accountId} must associate USDC ${config.USDC_TOKEN_ID} (npm run funders-associate)`,
    )
  }
  if (bal.usdc < config.USDC_DROP_AMOUNT) {
    warn(
      `funder #${funder.index} USDC ${bal.usdc} may be too low for ${config.USDC_DROP_AMOUNT} USDC drops`,
    )
  }
}

/**
 * For each wallet (random order):
 * 0. If on-chain USDC > threshold, skip drips
 * 1. Create Hedera account via funder if accountId missing (AccountCreateTransaction + initial HBAR)
 * 2. Else drip HBAR if needed
 * 3. TokenAssociateTransaction for USDC if needed
 * 4. Drop USDC from a random funder
 */
export async function fundWallets(config: KeeperConfig): Promise<void> {
  banner('Fund wallets (random order · random funders)')
  const store = await loadWallets(config)
  const funders = loadFunders(config)
  const client = createClient(config, {
    accountId: funders[0]!.accountId,
    privateKey: funders[0]!.privateKey,
  })
  const usdcBase = toBaseUnits(config.USDC_DROP_AMOUNT, config.USDC_DECIMALS)
  const tokenId = config.USDC_TOKEN_ID

  msg(
    `wallets=${store.wallets.length}  tokenId=${tokenId}  hbarDrip=${config.HBAR_DRIP_AMOUNT}  usdcDrop=${config.USDC_DROP_AMOUNT}`,
  )
  msg(`skip all drips if USDC > ${SKIP_DRIP_IF_USDC_GT}; create account on first fund if needed`)
  msg('checking 5 funders…')
  for (const funder of funders) {
    await assertFunderReady(config, funder, store.wallets.length)
  }

  const order = shuffle(store.wallets)
  msg(`processing ${order.length} wallets in shuffled order…`)

  let step = 0
  for (const wallet of order) {
    step += 1
    const live = store.wallets.find((w) => w.index === wallet.index) ?? wallet
    try {
      await fundOneWallet(config, client, funders, store, live, tokenId, usdcBase, step, order.length)
    } catch (err) {
      warn(`  skip wallet #${live.index}: ${err instanceof Error ? err.message : String(err)}`)
      log('fund.wallet.skip', {
        wallet: live.index,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    await sleep(randomInt(100, 800))
  }

  client.close()

  const fundedHbar = store.wallets.filter((w) => w.fundedHbar).length
  const fundedUsdc = store.wallets.filter((w) => w.fundedUsdc).length
  const associated = store.wallets.filter((w) => w.associatedUsdc).length
  ok(
    `funding complete  hbar=${fundedHbar}/${store.wallets.length}  associate=${associated}/${store.wallets.length}  usdc=${fundedUsdc}/${store.wallets.length}`,
  )
  log('fund.complete', { wallets: store.wallets.length, fundedHbar, fundedUsdc, associated })
}

async function fundOneWallet(
  config: KeeperConfig,
  client: ReturnType<typeof createClient>,
  funders: FunderAccount[],
  store: WalletStore,
  wallet: KeeperWallet,
  tokenId: string,
  usdcBase: bigint,
  step: number,
  total: number,
): Promise<void> {
  msg(`── ${step}/${total}  wallet #${wallet.index}  ${wallet.accountId || '(no account yet)'}`)

  // Create account if missing
  if (!wallet.accountId) {
    const creator = await pickFunderWithBalance(config, funders, {
      hbar: config.HBAR_DRIP_AMOUNT + 1,
    })
    msg(`  creating Hedera account from funder #${creator.index} (+ ${config.HBAR_DRIP_AMOUNT} HBAR)`)
    const key = keyFromWallet(wallet)
    client.setOperator(AccountId.fromString(creator.accountId), parsePrivateKey(creator.privateKey))
    const created = await createAccount(
      client,
      creator,
      key.publicKey,
      config.HBAR_DRIP_AMOUNT,
    )
    wallet.accountId = created.accountId
    wallet.fundedHbar = true
    wallet.hbarTxId = created.txId
    wallet.hbarFunder = creator.accountId
    await saveWallets(config, store)
    ok(`  account created ${created.accountId}  tx=${created.txId}`)
    log('fund.account.created', {
      wallet: wallet.index,
      accountId: created.accountId,
      txId: created.txId,
      funderIndex: creator.index,
    })
  }

  const onChain = await accountBalances(config, wallet.accountId, tokenId)
  if (onChain.usdc > SKIP_DRIP_IF_USDC_GT) {
    msg(
      `  skip drip — already has ${onChain.usdc} USDC (> ${SKIP_DRIP_IF_USDC_GT}); HBAR=${onChain.hbar}`,
    )
    wallet.associatedUsdc = true
    wallet.fundedUsdc = true
    if (onChain.hbar > 0) wallet.fundedHbar = true
    await saveWallets(config, store)
    log('fund.skip', {
      wallet: wallet.index,
      reason: 'usdc-above-threshold',
      usdc: onChain.usdc,
      threshold: SKIP_DRIP_IF_USDC_GT,
      hbar: onChain.hbar,
    })
    return
  }

  if (!wallet.fundedHbar && onChain.hbar < config.HBAR_DRIP_AMOUNT) {
    const hbarFunder = await pickFunderWithBalance(config, funders, {
      hbar: config.HBAR_DRIP_AMOUNT + 0.1,
    })
    msg(`  dripping ${config.HBAR_DRIP_AMOUNT} HBAR from funder #${hbarFunder.index}`)
    client.setOperator(
      AccountId.fromString(hbarFunder.accountId),
      parsePrivateKey(hbarFunder.privateKey),
    )
    const hbarTxId = await sendHbar(client, hbarFunder, wallet.accountId, config.HBAR_DRIP_AMOUNT)
    wallet.fundedHbar = true
    wallet.hbarTxId = hbarTxId
    wallet.hbarFunder = hbarFunder.accountId
    await saveWallets(config, store)
    ok(`  HBAR drip done  funder=#${hbarFunder.index}  tx=${hbarTxId}`)
    log('fund.hbar.done', { wallet: wallet.index, txId: hbarTxId, funderIndex: hbarFunder.index })
  } else {
    wallet.fundedHbar = true
    msg(`  HBAR already present (skip drip)`)
  }

  if (!wallet.associatedUsdc && !onChain.associatedUsdc) {
    msg(`  associating USDC ${tokenId}…`)
    const opt = await associateWalletToUsdc(client, config, wallet)
    wallet.associatedUsdc = true
    if (opt.txId) wallet.associateTxId = opt.txId
    await saveWallets(config, store)
  } else {
    wallet.associatedUsdc = true
    msg(`  already associated with USDC ${tokenId} (skip)`)
  }

  if (!wallet.fundedUsdc) {
    const usdcFunder = await pickFunderWithBalance(config, funders, {
      usdc: config.USDC_DROP_AMOUNT,
    })
    msg(`  dropping ${config.USDC_DROP_AMOUNT} USDC from funder #${usdcFunder.index}`)
    client.setOperator(
      AccountId.fromString(usdcFunder.accountId),
      parsePrivateKey(usdcFunder.privateKey),
    )
    const usdcTxId = await sendUsdc(
      client,
      usdcFunder,
      wallet.accountId,
      tokenId,
      usdcBase,
    )
    wallet.fundedUsdc = true
    wallet.usdcTxId = usdcTxId
    wallet.usdcFunder = usdcFunder.accountId
    await saveWallets(config, store)
    ok(`  USDC drop done  funder=#${usdcFunder.index}  tx=${usdcTxId}`)
    log('fund.usdc.done', { wallet: wallet.index, txId: usdcTxId, funderIndex: usdcFunder.index })
  } else {
    msg(`  USDC already dropped (skip)`)
    log('fund.skip', { wallet: wallet.index, reason: 'already-funded' })
  }
}

/** Associate all keeper wallets with USDC (standalone CLI step). */
export async function associateAllWallets(config: KeeperConfig): Promise<void> {
  banner(`USDC associate (${config.USDC_TOKEN_ID})`)
  const store = await loadWallets(config)
  const funders = loadFunders(config)
  const client = createClient(config, {
    accountId: funders[0]?.accountId || config.OPERATOR_ACCOUNT_ID,
    privateKey: funders[0]?.privateKey || config.OPERATOR_PRIVATE_KEY,
  })
  let done = 0
  let skipped = 0
  const order = shuffle(store.wallets)

  for (const wallet of order) {
    const live = store.wallets.find((w) => w.index === wallet.index) ?? wallet
    msg(`── wallet #${live.index}  ${live.accountId || '(missing)'}`)
    if (live.associatedUsdc) {
      skipped += 1
      msg(`  already marked associated (skip)`)
      continue
    }
    if (!live.accountId || !live.fundedHbar) {
      throw new Error(
        `Wallet #${live.index} has no account/HBAR yet. Run: npm run fund`,
      )
    }
    const result = await associateWalletToUsdc(client, config, live)
    live.associatedUsdc = true
    if (result.txId) live.associateTxId = result.txId
    await saveWallets(config, store)
    if (result.stage === 'already-associated') skipped += 1
    else done += 1
    await sleep(randomInt(100, 800))
  }

  client.close()
  ok(`associate complete  newlyAssociated=${done}  already=${skipped}  total=${store.wallets.length}`)
}

/** Associate all 5 funders with USDC. */
export async function associateAllFunders(config: KeeperConfig): Promise<void> {
  banner(`Funder USDC associate (${config.USDC_TOKEN_ID})`)
  const funders = loadFunders(config)
  const client = createClient(config, {
    accountId: funders[0]!.accountId,
    privateKey: funders[0]!.privateKey,
  })
  let store: Awaited<ReturnType<typeof loadFunderStore>> | null = null
  try {
    store = await loadFunderStore()
  } catch {
    warn('data/funders.json not found — associating from .env credentials only')
  }

  let done = 0
  let skipped = 0

  for (const funder of funders) {
    msg(`── funder #${funder.index}  ${funder.accountId}`)
    const bal = await accountBalances(config, funder.accountId, config.USDC_TOKEN_ID)
    msg(`  HBAR=${bal.hbar}  USDC=${bal.usdc}  associated=${bal.associatedUsdc}`)

    const result = await associateFunderToUsdc(client, config, funder)
    if (result.stage === 'already-associated') skipped += 1
    else done += 1

    if (store) {
      const row = store.funders.find(
        (f) => f.index === funder.index || f.accountId === funder.accountId,
      )
      if (row) {
        row.associatedUsdc = true
        if (result.txId) row.associateTxId = result.txId
        await saveFunderStore(store)
      }
    }
    await sleep(randomInt(100, 800))
  }

  client.close()
  ok(`funder associate complete  newlyAssociated=${done}  already=${skipped}  total=${funders.length}`)
  msg(`next: send USDC ${config.USDC_TOKEN_ID} to each funder (Circle faucet on testnet), then npm run fund`)
}
