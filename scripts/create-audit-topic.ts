/**
 * Create the Finality HCS audit topic (finality.audit.v1).
 *
 * The merchant operator key is both the admin key (so a buying agent's key can later be added to the
 * submit key with TopicUpdateTransaction) and the submit key (so only Finality can write today).
 *
 * Requires in .env: MERCHANT_OPERATOR_ID, MERCHANT_OPERATOR_KEY, X402_NETWORK.
 * Prints HCS_AUDIT_TOPIC_ID to paste back into .env.
 */
import { TopicCreateTransaction } from '@hiero-ledger/sdk'
import { createOperatorClient, type HederaNetworkName } from '../lib/hedera/hcs'
import { parseHederaPrivateKey } from '../lib/hedera/keys'
import { AUDIT_SCHEMA_ID } from '../lib/hedera/audit'

async function main() {
  const operatorId = process.env.MERCHANT_OPERATOR_ID?.trim()
  const operatorKey = process.env.MERCHANT_OPERATOR_KEY?.trim()
  const network = (process.env.X402_NETWORK?.trim() || 'hedera-testnet') as HederaNetworkName
  if (!operatorId || !operatorKey) throw new Error('Set MERCHANT_OPERATOR_ID and MERCHANT_OPERATOR_KEY')

  const client = createOperatorClient({ network, operatorId, operatorKey })
  const publicKey = parseHederaPrivateKey(operatorKey).publicKey
  try {
    const response = await new TopicCreateTransaction()
      .setTopicMemo(`Finality x402 audit log (${AUDIT_SCHEMA_ID})`)
      .setAdminKey(publicKey)
      .setSubmitKey(publicKey)
      .execute(client)
    const receipt = await response.getReceipt(client)
    const topicId = receipt.topicId?.toString()
    if (!topicId) throw new Error('Topic receipt has no topicId')
    const slug = network === 'hedera-mainnet' ? 'mainnet' : 'testnet'
    console.log(`Created audit topic ${topicId} on Hedera ${slug}`)
    console.log(`HashScan: https://hashscan.io/${slug}/topic/${topicId}`)
    console.log(`\nAdd to .env:\nHCS_AUDIT_TOPIC_ID=${topicId}`)
  } finally {
    client.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
