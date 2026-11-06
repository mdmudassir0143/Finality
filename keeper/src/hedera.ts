import {
  AccountCreateTransaction,
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  type PublicKey,
  Status,
  TokenAssociateTransaction,
  TokenId,
  TransferTransaction,
} from '@hiero-ledger/sdk'
import type { KeeperConfig } from './config.js'
import { hederaCaip2 } from './config.js'

export function parsePrivateKey(raw: string): PrivateKey {
  const s = raw.trim()
  if (!s) throw new Error('Empty private key')
  // Prefer explicit ECDSA (common for x402 / portal exports), then generic, then ED25519.
  const attempts: Array<() => PrivateKey> = [
    () => PrivateKey.fromStringECDSA(s),
    () => PrivateKey.fromString(s),
    () => PrivateKey.fromStringED25519(s),
  ]
  let last: unknown
  for (const attempt of attempts) {
    try {
      return attempt()
    } catch (err) {
      last = err
    }
  }
  throw new Error(
    `Unable to parse Hedera private key (DER/hex ECDSA or ED25519): ${
      last instanceof Error ? last.message : String(last)
    }`,
  )
}

export function createClient(config: KeeperConfig, operator?: { accountId: string; privateKey: string }): Client {
  const client =
    config.X402_NETWORK === 'hedera-mainnet' ? Client.forMainnet() : Client.forTestnet()
  if (operator?.accountId && operator.privateKey) {
    client.setOperator(AccountId.fromString(operator.accountId), parsePrivateKey(operator.privateKey))
  }
  return client
}

export async function accountBalances(
  config: KeeperConfig,
  accountId: string,
  usdcTokenId: string,
): Promise<{ hbar: number; usdc: number; associatedUsdc: boolean }> {
  if (!accountId || accountId.startsWith('PENDING')) {
    return { hbar: 0, usdc: 0, associatedUsdc: false }
  }
  const base = config.MIRROR_NODE_URL.replace(/\/$/, '')
  const res = await fetch(`${base}/api/v1/accounts/${encodeURIComponent(accountId)}`, {
    signal: AbortSignal.timeout(12_000),
  })
  if (res.status === 404) return { hbar: 0, usdc: 0, associatedUsdc: false }
  if (!res.ok) {
    throw new Error(`Mirror Node ${res.status} for account ${accountId}`)
  }
  const body = (await res.json()) as {
    balance?: { balance?: number; tokens?: Array<{ token_id?: string; balance?: number }> }
  }
  const tinybars = Number(body.balance?.balance ?? 0)
  const tokens = body.balance?.tokens ?? []
  const usdcRow = tokens.find((t) => t.token_id === usdcTokenId)
  return {
    hbar: tinybars / 1e8,
    usdc: usdcRow ? Number(usdcRow.balance ?? 0) / 1e6 : 0,
    associatedUsdc: Boolean(usdcRow),
  }
}

export async function sendHbar(
  client: Client,
  from: { accountId: string; privateKey: string },
  toAccountId: string,
  hbarAmount: number,
): Promise<string> {
  const key = parsePrivateKey(from.privateKey)
  const tx = await new TransferTransaction()
    .addHbarTransfer(AccountId.fromString(from.accountId), new Hbar(-hbarAmount))
    .addHbarTransfer(AccountId.fromString(toAccountId), new Hbar(hbarAmount))
    .freezeWith(client)
    .sign(key)
  const response = await tx.execute(client)
  const receipt = await response.getReceipt(client)
  if (receipt.status !== Status.Success) {
    throw new Error(`HBAR transfer failed: ${receipt.status.toString()}`)
  }
  return response.transactionId.toString()
}

export async function sendUsdc(
  client: Client,
  from: { accountId: string; privateKey: string },
  toAccountId: string,
  tokenId: string,
  amountBaseUnits: bigint,
): Promise<string> {
  const key = parsePrivateKey(from.privateKey)
  const tid = TokenId.fromString(tokenId)
  const tx = await new TransferTransaction()
    .addTokenTransfer(tid, AccountId.fromString(from.accountId), -Number(amountBaseUnits))
    .addTokenTransfer(tid, AccountId.fromString(toAccountId), Number(amountBaseUnits))
    .freezeWith(client)
    .sign(key)
  const response = await tx.execute(client)
  const receipt = await response.getReceipt(client)
  if (receipt.status !== Status.Success) {
    throw new Error(`USDC transfer failed: ${receipt.status.toString()}`)
  }
  return response.transactionId.toString()
}

export async function associateUsdc(
  client: Client,
  account: { accountId: string; privateKey: string },
  tokenId: string,
): Promise<string> {
  const key = parsePrivateKey(account.privateKey)
  const tx = await new TokenAssociateTransaction()
    .setAccountId(AccountId.fromString(account.accountId))
    .setTokenIds([TokenId.fromString(tokenId)])
    .freezeWith(client)
    .sign(key)
  const response = await tx.execute(client)
  const receipt = await response.getReceipt(client)
  if (receipt.status !== Status.Success) {
    throw new Error(`Token associate failed: ${receipt.status.toString()}`)
  }
  return response.transactionId.toString()
}

/**
 * Create a new Hedera account under `operator`, funded with `initialHbar`.
 * Returns the new account id + transaction id.
 */
export async function createAccount(
  client: Client,
  operator: { accountId: string; privateKey: string },
  newPublicKey: PublicKey,
  initialHbar: number,
): Promise<{ accountId: string; txId: string }> {
  client.setOperator(AccountId.fromString(operator.accountId), parsePrivateKey(operator.privateKey))
  const tx = await new AccountCreateTransaction()
    .setKeyWithoutAlias(newPublicKey)
    .setInitialBalance(new Hbar(initialHbar))
    .execute(client)
  const receipt = await tx.getReceipt(client)
  if (receipt.status !== Status.Success || !receipt.accountId) {
    throw new Error(`AccountCreate failed: ${receipt.status.toString()}`)
  }
  return {
    accountId: receipt.accountId.toString(),
    txId: tx.transactionId.toString(),
  }
}

export function networkLabel(config: KeeperConfig): string {
  return hederaCaip2(config.X402_NETWORK)
}
