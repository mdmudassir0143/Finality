import { FinalityError } from '../contracts/errors'
import type { ProviderResult, Quote } from './types'
import { cached } from './cache'

const BASE = 'https://api.dexscreener.com/latest/dex'
const timeout = 8_000

type DexPair = {
  baseToken?: { symbol?: string; name?: string }
  quoteToken?: { symbol?: string }
  priceUsd?: string
  liquidity?: { usd?: number }
  volume?: { h24?: number }
  priceChange?: { h24?: number }
  chainId?: string
}

async function getJson(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout) })
    if (response.status === 429) throw new FinalityError('provider_rate_limited', 'DexScreener rate limit reached', 503, true)
    if (!response.ok) throw new FinalityError('provider_unavailable', `DexScreener returned ${response.status}`, 503, true)
    return response.json()
  } catch (error) {
    if (error instanceof FinalityError) throw error
    throw new FinalityError('provider_unavailable', 'DexScreener is unavailable', 503, true)
  }
}

const meta = () => ({
  source: 'dexscreener',
  provider: 'public-rest',
  asOf: new Date().toISOString(),
  freshnessSeconds: 30,
  limitations: [
    'DEX spot pairs via DexScreener; not CEX order-book prices',
    'Used when CoinGecko is unavailable',
  ],
  availabilityTrack: 'durable' as const,
  dataMode: 'live' as const,
  synthetic: false,
})

function normalizeSymbol(symbol: string): string {
  return symbol.toUpperCase().replace(/[-_/]/g, '').replace(/(USDT|USD|USDC)$/, '')
}

function scorePair(pair: DexPair, symbol: string): number {
  const base = pair.baseToken?.symbol?.toUpperCase() ?? ''
  const quote = pair.quoteToken?.symbol?.toUpperCase() ?? ''
  const liquidity = Number(pair.liquidity?.usd ?? 0)
  if (base !== symbol) return -1
  if (liquidity < 25_000) return -1
  let score = liquidity
  if (['USDT', 'USDC', 'USD', 'DAI'].includes(quote)) score += 1e12
  // Prefer major L1s for well-known tickers
  if (['ethereum', 'solana', 'bsc', 'base', 'arbitrum', 'polygon'].includes(pair.chainId ?? '')) score += 1e9
  return score
}

function pickPair(pairs: DexPair[], symbol: string): DexPair {
  const ranked = pairs
    .map(pair => ({ pair, score: scorePair(pair, symbol) }))
    .filter(row => row.score >= 0)
    .sort((a, b) => b.score - a.score)
  if (!ranked.length) {
    throw new FinalityError('provider_unavailable', `DexScreener found no liquid pair for ${symbol}`, 503, true)
  }
  return ranked[0].pair
}

function toQuote(symbol: string, pair: DexPair): Quote {
  const price = Number(pair.priceUsd ?? 0)
  if (!Number.isFinite(price) || price <= 0) {
    throw new FinalityError('provider_unavailable', `DexScreener missing price for ${symbol}`, 503, true)
  }
  return {
    symbol: symbol.toUpperCase(),
    price,
    change24h: Number(pair.priceChange?.h24 ?? 0),
    volume24h: Number(pair.volume?.h24 ?? 0),
  }
}

export async function fetchDexScreenerQuotes(symbols: string[]): Promise<ProviderResult<Quote[]>> {
  const data = await Promise.all(
    symbols.map(async raw => {
      const symbol = normalizeSymbol(raw)
      return cached(`dexscreener:quote:${symbol}`, 20_000, async () => {
        const result = (await getJson(`${BASE}/search?q=${encodeURIComponent(symbol)}`)) as { pairs?: DexPair[] }
        const pair = pickPair(result.pairs ?? [], symbol)
        return toQuote(symbol, pair)
      })
    }),
  )
  return { data, meta: meta() }
}

/** Best-effort trending list from DexScreener boosted tokens → quote search. */
export async function fetchDexScreenerTrending(limit: number): Promise<ProviderResult<Quote[]>> {
  const boosts = await cached('dexscreener:boosts', 60_000, async () => {
    const result = (await getJson('https://api.dexscreener.com/token-boosts/top/v1')) as Array<{
      tokenAddress?: string
      chainId?: string
      description?: string
    }>
    return Array.isArray(result) ? result : []
  })

  const symbols: string[] = []
  for (const row of boosts) {
    // Prefer searching by token address for accurate pair selection
    if (!row.tokenAddress || !row.chainId) continue
    try {
      const pairs = (await getJson(`${BASE}/tokens/${encodeURIComponent(row.tokenAddress)}`)) as { pairs?: DexPair[] }
      const list = pairs.pairs ?? []
      if (!list.length) continue
      const best = [...list].sort((a, b) => Number(b.liquidity?.usd ?? 0) - Number(a.liquidity?.usd ?? 0))[0]
      const symbol = normalizeSymbol(best.baseToken?.symbol ?? '')
      if (!symbol || symbols.includes(symbol)) continue
      symbols.push(symbol)
      if (symbols.length >= limit) break
    } catch {
      /* skip unhealthy boost entries */
    }
  }

  if (!symbols.length) {
    // Fallback majors if boosts endpoint is empty/rate-limited
    return fetchDexScreenerQuotes(['ETH', 'SOL', 'BTC', 'LINK', 'DOGE'].slice(0, limit))
  }
  return fetchDexScreenerQuotes(symbols.slice(0, limit))
}
