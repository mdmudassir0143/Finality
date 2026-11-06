import { z } from 'zod'
import { HEDERA_TRANSACTION_ID_REGEX } from '../../lib/onchain/hedera/mirror'

const symbols = z.array(z.string().trim().min(1).max(20)).min(1).max(10)
const market = z.enum(['crypto','meme','forex','equity','etf']).default('crypto')
const base = z.object({ symbols: symbols.default(['BTC']), marketType: market, interval: z.enum(['1m','5m','15m','1h','4h','1d']).default('1h'), limit: z.number().int().min(2).max(500).default(100) })
const hederaId = z.string().trim().max(32).regex(/^0\.0\.\d+$/, 'Invalid Hedera entity id')

export const requestSchemas: Record<string, z.ZodTypeAny> = {
  'market.quotes': z.object({ symbols }),
  'market.assets': z.object({ query: z.string().trim().min(1).max(40), limit: z.number().int().min(1).max(20).default(10) }),
  'market.candles': base,
  'market.trending': z.object({ limit: z.number().int().min(1).max(20).default(10) }),
  'market.categories': z.object({}),
  'market.tokenPrices': z.object({
    network: z.string().trim().min(2).max(32).default('eth'),
    addresses: z.array(z.string().trim().min(8).max(128)).min(1).max(20),
  }),
  'market.fearGreed': z.object({ limit: z.number().int().min(1).max(30).default(1) }),
  'intelligence.signals': base,
  'intelligence.technicals': base,
  'intelligence.report': base,
  'intelligence.volume': base,
  'intelligence.events': base,
  'intelligence.backtest': base.extend({ strategy: z.object({ fastPeriod: z.number().int().min(2).max(100).default(10), slowPeriod: z.number().int().min(3).max(200).default(30), initialCapital: z.number().positive().max(1_000_000).default(10_000) }).default({}) }),
  'agent.decision': base.extend({ risk: z.enum(['conservative','balanced','aggressive']).default('balanced') }),
  'agent.briefing': base,
  'agent.strategyParse': z.object({ prompt: z.string().min(5).max(2000) }),
  'ai.chat': base.extend({ prompt: z.string().min(1).max(4000) }),
  'onchain.hederaAccount': z.object({ accountId: hederaId }),
  'onchain.hederaBalances': z.object({ accountId: hederaId, limit: z.number().int().min(1).max(100).default(25) }),
  'onchain.hederaToken': z.object({ tokenId: hederaId }),
  'onchain.hederaTransaction': z.object({ transactionId: z.string().trim().min(5).max(120).regex(HEDERA_TRANSACTION_ID_REGEX, 'Use 0.0.x@seconds.nanos or 0.0.x-seconds-nanos') }),
  'onchain.hederaTopic': z.object({ topicId: hederaId, limit: z.number().int().min(1).max(100).default(25) }),
  'onchain.hederaNetworkSupply': z.object({}),
  'onchain.hederaNetworkNodes': z.object({}),
  'onchain.hederaBlocks': z.object({ limit: z.number().int().min(1).max(25).default(10) }),
}

export function parseRequest(operationId: string, value: unknown) {
  return requestSchemas[operationId].parse(value)
}
