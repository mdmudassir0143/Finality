/** Mirrors Finality x402-server paid catalog for autonomous traffic. */
export type PaidEndpoint = {
  operationId: string
  method: 'GET' | 'POST'
  path: string
  /** Catalog price string, e.g. "$0.15" — used for random USDC-cost selection. */
  price: string
}

export const allEndpoints: PaidEndpoint[] = [
  { operationId: 'market.quotes', method: 'GET', path: '/v1/market/quotes', price: '$0.15' },
  { operationId: 'market.assets', method: 'GET', path: '/v1/market/assets', price: '$0.15' },
  { operationId: 'market.candles', method: 'POST', path: '/v1/market/candles', price: '$0.25' },
  { operationId: 'market.trending', method: 'GET', path: '/v1/market/trending', price: '$0.20' },
  { operationId: 'market.categories', method: 'GET', path: '/v1/market/categories', price: '$0.15' },
  { operationId: 'market.tokenPrices', method: 'GET', path: '/v1/market/token-prices', price: '$0.20' },
  { operationId: 'market.fearGreed', method: 'GET', path: '/v1/market/fear-greed', price: '$0.10' },
  { operationId: 'intelligence.signals', method: 'POST', path: '/v1/signals', price: '$1.85' },
  { operationId: 'intelligence.technicals', method: 'POST', path: '/v1/technicals', price: '$1.85' },
  { operationId: 'intelligence.report', method: 'POST', path: '/v1/analysis/report', price: '$3.10' },
  { operationId: 'intelligence.volume', method: 'POST', path: '/v1/analysis/volume', price: '$1.00' },
  { operationId: 'intelligence.events', method: 'POST', path: '/v1/analysis/events', price: '$1.85' },
  { operationId: 'intelligence.backtest', method: 'POST', path: '/v1/backtest', price: '$3.10' },
  { operationId: 'agent.decision', method: 'POST', path: '/v1/agent/decision', price: '$2.40' },
  { operationId: 'agent.briefing', method: 'POST', path: '/v1/agent/briefing', price: '$3.10' },
  { operationId: 'agent.strategyParse', method: 'POST', path: '/v1/agent/strategy/parse', price: '$2.40' },
  { operationId: 'ai.chat', method: 'POST', path: '/v1/ai/chat', price: '$4.00' },
  { operationId: 'onchain.hederaAccount', method: 'POST', path: '/v1/onchain/hedera/account', price: '$0.25' },
  { operationId: 'onchain.hederaBalances', method: 'POST', path: '/v1/onchain/hedera/balances', price: '$0.35' },
  { operationId: 'onchain.hederaToken', method: 'POST', path: '/v1/onchain/hedera/token', price: '$0.20' },
  { operationId: 'onchain.hederaTransaction', method: 'POST', path: '/v1/onchain/hedera/transaction', price: '$0.25' },
  { operationId: 'onchain.hederaTopic', method: 'POST', path: '/v1/onchain/hedera/topic', price: '$0.30' },
  { operationId: 'onchain.hederaNetworkSupply', method: 'GET', path: '/v1/onchain/hedera/network/supply', price: '$0.10' },
  { operationId: 'onchain.hederaNetworkNodes', method: 'GET', path: '/v1/onchain/hedera/network/nodes', price: '$0.15' },
  { operationId: 'onchain.hederaBlocks', method: 'GET', path: '/v1/onchain/hedera/blocks', price: '$0.20' },
]

/** @deprecated prefer activeEndpoints(filter) */
export const endpoints = allEndpoints

/**
 * Filter catalog routes for the traffic loop.
 * - `onchain` — Hedera Mirror Node routes
 * - `pro` — Intelligence + Agent tools + AI analyst (Gemini-backed)
 * - `onchain,pro` (default) — durable on-chain + pro
 * - `all` / `*` — full catalog
 * - comma list of operationId prefixes/ids
 */
export function activeEndpoints(filter = 'onchain,pro'): PaidEndpoint[] {
  const raw = filter.trim().toLowerCase()
  if (!raw || raw === 'all' || raw === '*') return [...allEndpoints]
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean)
  const expanded = parts.flatMap((p) => {
    if (p === 'onchain') return ['onchain.']
    if (p === 'pro') return ['intelligence.', 'agent.', 'ai.']
    if (p === 'market') return ['market.']
    return [p]
  })
  const selected = allEndpoints.filter((e) =>
    expanded.some(
      (p) =>
        e.operationId === p ||
        e.operationId.startsWith(p.endsWith('.') ? p : `${p}.`) ||
        e.operationId.startsWith(p),
    ),
  )
  if (!selected.length) {
    throw new Error(`ENDPOINT_FILTER=${filter} matched 0 routes`)
  }
  return selected
}

const query: Record<string, string> = {
  'market.quotes': 'symbols=BTC',
  'market.assets': 'query=BTC&limit=10',
  'market.trending': 'limit=10',
  'market.categories': '',
  'market.tokenPrices':
    'network=eth&addresses=0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  'market.fearGreed': 'limit=1',
  'onchain.hederaNetworkSupply': '',
  'onchain.hederaNetworkNodes': '',
  'onchain.hederaBlocks': 'limit=10',
}

const bodies: Record<string, Record<string, unknown>> = {
  'market.candles': { symbols: ['BTC'], marketType: 'crypto', interval: '1h', limit: 30 },
  'intelligence.signals': { symbols: ['BTC'], marketType: 'crypto', interval: '1h', limit: 30 },
  'intelligence.technicals': { symbols: ['BTC'], marketType: 'crypto', interval: '1h', limit: 30 },
  'intelligence.report': { symbols: ['BTC'], marketType: 'crypto', interval: '1h', limit: 30 },
  'intelligence.volume': { symbols: ['BTC'], marketType: 'crypto', interval: '1h', limit: 30 },
  'intelligence.events': { symbols: ['BTC'], marketType: 'crypto', interval: '1h', limit: 30 },
  'intelligence.backtest': {
    symbols: ['BTC'],
    marketType: 'crypto',
    interval: '1h',
    limit: 50,
    strategy: { fastPeriod: 5, slowPeriod: 10, initialCapital: 10000 },
  },
  'agent.decision': {
    symbols: ['BTC'],
    marketType: 'crypto',
    interval: '1h',
    limit: 30,
    risk: 'balanced',
  },
  'agent.briefing': { symbols: ['BTC'], marketType: 'crypto', interval: '1h', limit: 30 },
  'agent.strategyParse': { prompt: 'Buy when fast 10 crosses above slow 30' },
  'ai.chat': {
    symbols: ['BTC'],
    marketType: 'crypto',
    interval: '1h',
    limit: 30,
    prompt: 'Analyze BTC',
  },
  'onchain.hederaAccount': { accountId: 'WALLET' },
  'onchain.hederaBalances': { accountId: 'WALLET', limit: 25 },
  'onchain.hederaToken': { tokenId: '0.0.429274' },
  'onchain.hederaTransaction': { transactionId: '0.0.1001@1700000000.000000000' },
  'onchain.hederaTopic': { topicId: '0.0.1002', limit: 25 },
}

export function buildRequest(
  endpoint: PaidEndpoint,
  payerAccountId: string,
): { urlPath: string; init: RequestInit; usdcPrice: number } {
  const usdcPrice = Number(endpoint.price.replace('$', ''))
  if (endpoint.method === 'GET') {
    const q = (query[endpoint.operationId] ?? '').replaceAll('WALLET', payerAccountId)
    return {
      urlPath: q ? `${endpoint.path}?${q}` : endpoint.path,
      init: { method: 'GET' },
      usdcPrice,
    }
  }
  const body = { ...(bodies[endpoint.operationId] ?? {}) }
  if (body.accountId === 'WALLET') body.accountId = payerAccountId
  return {
    urlPath: endpoint.path,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    usdcPrice,
  }
}
