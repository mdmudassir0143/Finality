export type OperationId = typeof endpoints[number]['operationId']
export type Endpoint = typeof endpoints[number]

/** USD catalog prices. Settlement accepts USDC (HTS) or equivalent HBAR via configured rate. */
export const endpoints = [
  ['market.quotes','GET','/v1/market/quotes','$0.15','Bounded crypto spot quotes','durable'],
  ['market.assets','GET','/v1/market/assets','$0.15','Asset search and symbol normalization','durable'],
  ['market.candles','POST','/v1/market/candles','$0.25','Bounded OHLCV history','durable'],
  ['market.trending','GET','/v1/market/trending','$0.20','Ranked crypto assets','durable'],
  ['market.categories','GET','/v1/market/categories','$0.15','Coin categories by 24h market-cap change','durable'],
  ['market.tokenPrices','GET','/v1/market/token-prices','$0.20','ERC-20 / on-chain token USD prices','durable'],
  ['market.fearGreed','GET','/v1/market/fear-greed','$0.10','Crypto Fear and Greed index','durable'],
  ['intelligence.signals','POST','/v1/signals','$1.85','Multi-market signals and summary','quota-limited'],
  ['intelligence.technicals','POST','/v1/technicals','$1.85','Technical indicators and regime','quota-limited'],
  ['intelligence.report','POST','/v1/analysis/report','$3.10','Combined intelligence report','quota-limited'],
  ['intelligence.volume','POST','/v1/analysis/volume','$1.00','Volume participation analysis','quota-limited'],
  ['intelligence.events','POST','/v1/analysis/events','$1.85','Market event intelligence','quota-limited'],
  ['intelligence.backtest','POST','/v1/backtest','$3.10','Bounded strategy backtest','quota-limited'],
  ['agent.decision','POST','/v1/agent/decision','$2.40','Gemini risk-aware decision','quota-limited'],
  ['agent.briefing','POST','/v1/agent/briefing','$3.10','Gemini market briefing','quota-limited'],
  ['agent.strategyParse','POST','/v1/agent/strategy/parse','$2.40','Natural language strategy parser','quota-limited'],
  ['ai.chat','POST','/v1/ai/chat','$4.00','Gemini data-grounded analyst response','quota-limited'],
  ['onchain.hederaAccount','POST','/v1/onchain/hedera/account','$0.25','Hedera account intelligence via Mirror Node','durable'],
  ['onchain.hederaBalances','POST','/v1/onchain/hedera/balances','$0.35','HBAR and HTS holdings for an account','durable'],
  ['onchain.hederaToken','POST','/v1/onchain/hedera/token','$0.20','Hedera token metadata','durable'],
  ['onchain.hederaTransaction','POST','/v1/onchain/hedera/transaction','$0.25','Transaction detail and transfers','durable'],
  ['onchain.hederaTopic','POST','/v1/onchain/hedera/topic','$0.30','HCS topic messages (bounded)','durable'],
  ['onchain.hederaNetworkSupply','GET','/v1/onchain/hedera/network/supply','$0.10','Network HBAR supply','durable'],
  ['onchain.hederaNetworkNodes','GET','/v1/onchain/hedera/network/nodes','$0.15','Network node snapshot','durable'],
  ['onchain.hederaBlocks','GET','/v1/onchain/hedera/blocks','$0.20','Recent blocks (bounded)','durable'],
].map(([operationId,method,path,price,description,availabilityTrack]) => ({ operationId, method, path, price, description, availabilityTrack, version: '1.0.0', limits: { symbols: 10, candles: 500, bodyBytes: 32_768 } })) as Array<{operationId: string; method: 'GET'|'POST'; path: string; price: string; description: string; availabilityTrack: 'durable'|'quota-limited'; version: string; limits: {symbols:number;candles:number;bodyBytes:number}}>

export const byOperationId = new Map(endpoints.map(endpoint => [endpoint.operationId, endpoint]))
