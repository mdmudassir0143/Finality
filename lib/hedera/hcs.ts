import { AccountId, Client, TopicId, TopicMessageSubmitTransaction } from '@hiero-ledger/sdk'
import { encodeAuditMessage, type AuditMessage } from './audit'
import { parseHederaPrivateKey } from './keys'

export type HederaNetworkName = 'hedera-testnet' | 'hedera-mainnet'

export type OperatorConfig = {
  network: HederaNetworkName
  operatorId: string
  operatorKey: string
}

export function createOperatorClient({ network, operatorId, operatorKey }: OperatorConfig): Client {
  const client = network === 'hedera-mainnet' ? Client.forMainnet() : Client.forTestnet()
  client.setOperator(AccountId.fromString(operatorId), parseHederaPrivateKey(operatorKey))
  return client
}

export type SubmitResult = { sequenceNumber: string; transactionId: string }
export type SubmitFn = (topicId: string, message: string) => Promise<SubmitResult>

/** Submit one message with the operator as payer and signer (the operator key is the topic submit key). */
export function sdkSubmitter(client: Client): SubmitFn {
  return async (topicId, message) => {
    const response = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(message)
      .execute(client)
    const receipt = await response.getReceipt(client)
    return {
      sequenceNumber: receipt.topicSequenceNumber?.toString() ?? '',
      transactionId: response.transactionId.toString(),
    }
  }
}

type Logger = (level: 'info' | 'warn', message: string, data?: Record<string, unknown>) => void

const defaultLogger: Logger = (level, message, data) => {
  const line = JSON.stringify({ level, message, ...data })
  if (level === 'warn') console.warn(line)
  else console.log(line)
}

/**
 * Fire-and-forget HCS audit publisher.
 *
 * `publish()` validates and enqueues synchronously and never throws for network problems, so callers
 * (the x402 settle hook, the agent loop) are never slowed down or failed by the audit log. Messages are
 * submitted one at a time in order. If the queue is full, the oldest pending message is dropped and a
 * warning is logged.
 */
export class AuditPublisher {
  private queue: string[] = []
  private draining: Promise<void> | null = null
  readonly published: SubmitResult[] = []
  failures = 0

  constructor(
    private readonly topicId: string,
    private readonly submit: SubmitFn,
    private readonly options: { maxQueue?: number; logger?: Logger } = {},
  ) {}

  publish(message: AuditMessage): boolean {
    let encoded: string
    try {
      encoded = encodeAuditMessage(message)
    } catch (error) {
      this.log('warn', 'hcs.audit.invalid', { error: String(error) })
      return false
    }
    const maxQueue = this.options.maxQueue ?? 500
    if (this.queue.length >= maxQueue) {
      this.queue.shift()
      this.log('warn', 'hcs.audit.queue_full', { maxQueue })
    }
    this.queue.push(encoded)
    if (!this.draining) this.draining = this.drain().finally(() => { this.draining = null })
    return true
  }

  /** Resolves when every queued message has been attempted. */
  async flush(): Promise<void> {
    while (this.draining) await this.draining
  }

  private async drain(): Promise<void> {
    while (this.queue.length) {
      const message = this.queue.shift() as string
      try {
        const result = await this.submit(this.topicId, message)
        this.published.push(result)
        if (this.published.length > 100) this.published.shift()
        this.log('info', 'hcs.audit.submitted', { topicId: this.topicId, ...result })
      } catch (error) {
        this.failures += 1
        this.log('warn', 'hcs.audit.submit_failed', { topicId: this.topicId, error: String(error) })
      }
    }
  }

  private log(level: 'info' | 'warn', message: string, data?: Record<string, unknown>) {
    ;(this.options.logger ?? defaultLogger)(level, message, data)
  }
}
