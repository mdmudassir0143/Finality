/**
 * Associate Circle USDC (HTS) for a Hedera payer account.
 * Requires X402_TEST_PAYER_ACCOUNT_ID + X402_TEST_PAYER_PRIVATE_KEY and network HBAR for fees
 * (or use HashPack UI to associate token 0.0.429274 on testnet / 0.0.456858 on mainnet).
 */
import { AccountId, Client, TokenAssociateTransaction, TokenId } from '@hiero-ledger/sdk'
import { parseHederaPrivateKey } from '../lib/hedera/keys'

async function main() {
  const accountId = process.env.X402_TEST_PAYER_ACCOUNT_ID
  const keyRaw = process.env.X402_TEST_PAYER_PRIVATE_KEY
  const tokenId = process.env.X402_USDC_TOKEN_ID || '0.0.429274'
  const network = process.env.X402_NETWORK || 'hedera-testnet'
  if (!accountId || !keyRaw) throw new Error('Set X402_TEST_PAYER_ACCOUNT_ID and X402_TEST_PAYER_PRIVATE_KEY')

  const client = network.includes('mainnet') ? Client.forMainnet() : Client.forTestnet()
  const key = parseHederaPrivateKey(keyRaw)
  client.setOperator(AccountId.fromString(accountId), key)
  try {
    const tx = await new TokenAssociateTransaction()
      .setAccountId(AccountId.fromString(accountId))
      .setTokenIds([TokenId.fromString(tokenId)])
      .freezeWith(client)
      .sign(key)
    const response = await tx.execute(client)
    const receipt = await response.getReceipt(client)
    console.log('associated', tokenId, 'status', receipt.status.toString())
  } finally {
    client.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
