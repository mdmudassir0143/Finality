import { AccountId, type Client } from '@hiero-ledger/sdk'
import type { KeeperConfig } from './config.js'
import { accountBalances, associateUsdc, parsePrivateKey } from './hedera.js'
import type { FunderAccount, KeeperWallet } from './types.js'
import { log, msg, ok, warn } from './util.js'

export type AssociateResult = {
  stage: 'already-associated' | 'associated'
  accountId: string
  tokenId: string
  hbar: number
  txId?: string
}

/**
 * Associate an account with USDC (HTS).
 */
export async function associateAccountToUsdc(
  client: Client,
  config: KeeperConfig,
  account: { accountId: string; privateKey: string },
  label: string,
  tokenId: string = config.USDC_TOKEN_ID,
): Promise<AssociateResult> {
  const bal = await accountBalances(config, account.accountId, tokenId)
  log('associate.balance', { accountId: account.accountId, hbar: bal.hbar, tokenId, label })
  msg(`  ${label} balance ${bal.hbar} HBAR`)

  if (bal.associatedUsdc) {
    log('associate.already', { accountId: account.accountId, tokenId, label })
    warn(`  ${label} already associated with USDC ${tokenId}`)
    return { stage: 'already-associated', accountId: account.accountId, tokenId, hbar: bal.hbar }
  }

  if (bal.hbar <= 0) {
    throw new Error(`${label} ${account.accountId} needs HBAR before TokenAssociateTransaction`)
  }

  client.setOperator(AccountId.fromString(account.accountId), parsePrivateKey(account.privateKey))
  const txId = await associateUsdc(client, account, tokenId)
  log('associate.done', { accountId: account.accountId, tokenId, txId, label })
  ok(`  ${label} associated USDC ${tokenId}  tx=${txId}`)
  return { stage: 'associated', accountId: account.accountId, tokenId, hbar: bal.hbar, txId }
}

export async function associateWalletToUsdc(
  client: Client,
  config: KeeperConfig,
  wallet: KeeperWallet,
): Promise<AssociateResult> {
  if (!wallet.accountId) {
    throw new Error(`Wallet #${wallet.index} has no accountId yet — run fund first`)
  }
  return associateAccountToUsdc(
    client,
    config,
    { accountId: wallet.accountId, privateKey: wallet.privateKey },
    `wallet #${wallet.index}`,
  )
}

export async function associateFunderToUsdc(
  client: Client,
  config: KeeperConfig,
  funder: FunderAccount,
): Promise<AssociateResult> {
  return associateAccountToUsdc(
    client,
    config,
    { accountId: funder.accountId, privateKey: funder.privateKey },
    `funder #${funder.index}`,
  )
}
