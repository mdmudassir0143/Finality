import { merchantUrl } from '@/lib/x402/client'

export type CatalogEndpoint = {
  operationId: string
  method: 'GET' | 'POST'
  path: string
  price: string
  description: string
  availabilityTrack: string
  limits: Record<string, number>
  requestExample: Record<string, unknown>
}

export type EndpointMeta = { title: string; category: string; use: string }

export const ENDPOINT_DETAILS: Record<string, EndpointMeta> = {
  'market.quotes': { title: 'Live Quotes', category: 'Market data', use: 'Current spot price, 24h change and volume' },
  'market.assets': { title: 'Asset Search', category: 'Market data', use: 'Find and normalize supported symbols' },
  'market.candles': { title: 'Price Candles', category: 'Market data', use: 'Bounded OHLCV history for analysis' },
  'market.trending': { title: 'Trending Markets', category: 'Market data', use: 'Rank liquid assets by current volume' },
  'market.categories': { title: 'Coin Categories', category: 'Market data', use: 'Categories ranked by 24h market-cap change' },
  'market.tokenPrices': { title: 'Token Prices', category: 'Market data', use: 'ERC-20 / on-chain token USD prices' },
  'market.fearGreed': { title: 'Fear & Greed', category: 'Market data', use: 'Daily crypto market sentiment' },
  'intelligence.signals': { title: 'Trading Signals', category: 'Intelligence', use: 'Directional signal with score and regime' },
  'intelligence.technicals': { title: 'Technical Snapshot', category: 'Intelligence', use: 'SMA, RSI, momentum and market regime' },
  'intelligence.report': { title: 'Market Report', category: 'Intelligence', use: 'Combined technical signal and risk view' },
  'intelligence.volume': { title: 'Volume Analysis', category: 'Intelligence', use: 'Participation, average volume and spike detection' },
  'intelligence.events': { title: 'Price Events', category: 'Intelligence', use: 'Detect statistically meaningful price moves' },
  'intelligence.backtest': { title: 'Strategy Backtest', category: 'Intelligence', use: 'Test a moving-average strategy on history' },
  'agent.decision': { title: 'Agent Decision', category: 'Agent tools', use: 'Bounded action, confidence and position limit' },
  'agent.briefing': { title: 'Agent Briefing', category: 'Agent tools', use: 'Compact machine-readable market context' },
  'agent.strategyParse': { title: 'Strategy Parser', category: 'Agent tools', use: 'Turn plain language into validated rules' },
  'ai.chat': { title: 'AI Market Analyst', category: 'AI analyst', use: 'Ask a concise Gemini-powered market question' },
  'onchain.hederaAccount': { title: 'Hedera Account', category: 'Hedera', use: 'Inspect an account via Mirror Node' },
  'onchain.hederaBalances': { title: 'Account Balances', category: 'Hedera', use: 'HBAR and HTS holdings for an account' },
  'onchain.hederaToken': { title: 'Token Metadata', category: 'Hedera', use: 'Fungible or NFT token parameters' },
  'onchain.hederaTransaction': { title: 'Transaction', category: 'Hedera', use: 'Transaction detail and transfers' },
  'onchain.hederaTopic': { title: 'HCS Topic', category: 'Hedera', use: 'Bounded topic message history' },
  'onchain.hederaNetworkSupply': { title: 'Network Supply', category: 'Hedera', use: 'Released and total HBAR supply' },
  'onchain.hederaNetworkNodes': { title: 'Network Nodes', category: 'Hedera', use: 'Consensus node snapshot' },
  'onchain.hederaBlocks': { title: 'Recent Blocks', category: 'Hedera', use: 'Bounded recent block headers' },
}

export const CATEGORY_ORDER = ['Market data', 'Intelligence', 'Agent tools', 'AI analyst', 'Hedera'] as const

export const PRO_CATEGORIES = new Set(['Intelligence', 'Agent tools', 'AI analyst'])

export function metaFor(operationId: string): EndpointMeta {
  return ENDPOINT_DETAILS[operationId] || { title: operationId, category: 'Other', use: '' }
}

export function isProEndpoint(operationId: string): boolean {
  return PRO_CATEGORIES.has(metaFor(operationId).category)
}

async function readJson(path: string): Promise<any> {
  let r: Response
  try {
    r = await fetch(`${merchantUrl}${path}`, { cache: 'no-store' })
  } catch {
    throw new Error('Merchant unreachable')
  }
  // A proxy error page (HTML) when the merchant is down must not surface as "Unexpected token <".
  const v = await r.json().catch(() => null)
  if (!r.ok) {
    const reason = typeof v?.error === 'string' ? v.error : v?.error?.message
    throw new Error(reason || `Merchant returned HTTP ${r.status}`)
  }
  if (v == null || typeof v !== 'object') throw new Error('Merchant returned an invalid response')
  return v
}

const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x)

function toEndpoint(v: any): CatalogEndpoint | null {
  if (!isObj(v) || typeof v.operationId !== 'string' || typeof v.path !== 'string') return null
  return {
    operationId: v.operationId,
    method: String(v.method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET',
    path: v.path,
    price: typeof v.price === 'string' ? v.price : v.price != null ? `$${v.price}` : '—',
    description: typeof v.description === 'string' ? v.description : '',
    availabilityTrack: typeof v.availabilityTrack === 'string' ? v.availabilityTrack : '',
    limits: isObj(v.limits) ? v.limits : {},
    requestExample: isObj(v.requestExample) ? v.requestExample : {},
  }
}

export async function fetchCatalog(): Promise<CatalogEndpoint[]> {
  const v = await readJson('/v1/catalog')
  if (!Array.isArray(v.data)) return []
  return v.data.map(toEndpoint).filter((e: CatalogEndpoint | null): e is CatalogEndpoint => e !== null)
}

/** Numeric USD amount of a catalog price such as "$0.15" (NaN when unparseable). */
export function priceValue(price: string): number {
  return Number.parseFloat(price.replace(/[^0-9.]/g, ''))
}

export async function fetchHealth(): Promise<Record<string, unknown>> {
  return readJson('/health')
}
