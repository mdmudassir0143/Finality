export type KeeperWallet = {
  index: number
  /** Hedera account id, e.g. 0.0.1234. Empty until funded/created on-chain. */
  accountId: string
  /** ECDSA/ED25519 private key as DER or hex string. */
  privateKey: string
  createdAt: string
  fundedHbar?: boolean
  fundedUsdc?: boolean
  /** TokenAssociateTransaction completed for USDC. */
  associatedUsdc?: boolean
  hbarTxId?: string
  associateTxId?: string
  usdcTxId?: string
  hbarFunder?: string
  usdcFunder?: string
}

/**
 * State files written before the association rename used older field names.
 * Map them forward on load so already-associated accounts stay "ready".
 */
const LEGACY_FIELD_MAP: Record<string, 'associatedUsdc' | 'associateTxId'> = {
  optedInUsdc: 'associatedUsdc',
  optInTxId: 'associateTxId',
}

export function normalizeAssociationFields<T extends { associatedUsdc?: boolean; associateTxId?: string }>(row: T): T {
  const record = row as T & Record<string, unknown>
  for (const [legacy, current] of Object.entries(LEGACY_FIELD_MAP)) {
    if (legacy in record) {
      if (record[current] === undefined) (record as Record<string, unknown>)[current] = record[legacy]
      delete record[legacy]
    }
  }
  return row
}

export type WalletStore = {
  network: 'hedera-testnet' | 'hedera-mainnet'
  count: number
  createdAt: string
  updatedAt: string
  wallets: KeeperWallet[]
}

export type FunderAccount = {
  index: number
  accountId: string
  privateKey: string
}
