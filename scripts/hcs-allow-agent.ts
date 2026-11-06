/**
 * Let the research agent write `spend` records to the Finality HCS audit topic.
 *
 * The topic was created with the merchant operator key as both admin and submit key. This replaces the submit
 * key with a 1-of-N KeyList (merchant operator, the research agent X402_TEST_PAYER_PRIVATE_KEY, and every
 * HCS-11 agent AGENT_<ID>_PRIVATE_KEY in .env), signed by the admin (operator). Any of them can append records;
 * nobody else can. Idempotent: re-run after provisioning a new agent.
 *
 * Requires in .env: MERCHANT_OPERATOR_ID, MERCHANT_OPERATOR_KEY, HCS_AUDIT_TOPIC_ID, X402_TEST_PAYER_PRIVATE_KEY.
 */
import { KeyList, TopicId, TopicInfoQuery, TopicUpdateTransaction } from '@hiero-ledger/sdk'
import { createOperatorClient, type HederaNetworkName } from '../lib/hedera/hcs'
import { parseHederaPrivateKey } from '../lib/hedera/keys'

async function main() {
  const need = (name: string) => {
    const v = process.env[name]?.trim()
    if (!v) throw new Error(`Set ${name}`)
    return v
  }
  const network = (process.env.X402_NETWORK?.trim() || 'hedera-testnet') as HederaNetworkName
  const operatorId = need('MERCHANT_OPERATOR_ID')
  const operatorKey = need('MERCHANT_OPERATOR_KEY')
  const topicId = TopicId.fromString(need('HCS_AUDIT_TOPIC_ID'))
  const merchantPublic = parseHederaPrivateKey(operatorKey).publicKey
  const agentVars = ['X402_TEST_PAYER_PRIVATE_KEY', ...Object.keys(process.env).filter((k) => /^AGENT_[A-Z0-9_]+_PRIVATE_KEY$/.test(k)).sort()]
  const agentKeys = agentVars.filter((k) => process.env[k]?.trim()).map((k) => parseHederaPrivateKey(process.env[k]!.trim()).publicKey)

  const client = createOperatorClient({ network, operatorId, operatorKey })
  try {
    const submitKey = new KeyList([merchantPublic, ...agentKeys], 1)
    const response = await new TopicUpdateTransaction().setTopicId(topicId).setSubmitKey(submitKey).execute(client)
    const receipt = await response.getReceipt(client)
    const info = await new TopicInfoQuery().setTopicId(topicId).execute(client)
    console.log(`Topic ${topicId} submit key updated: ${receipt.status.toString()} (tx ${response.transactionId.toString()})`)
    console.log(`Submit key is now: ${info.submitKey?.toString()}`)
    console.log(`Writers (1-of-${agentKeys.length + 1}): merchant operator, ${agentVars.join(', ')}`)
  } finally {
    client.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
