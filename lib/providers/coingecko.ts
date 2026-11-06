import { FinalityError } from '../contracts/errors'
import type { Candle, ProviderResult, Quote } from './types'
import { cached } from './cache'

const DEMO_BASE = 'https://api.coingecko.com/api/v3'
const PRO_BASE = 'https://pro-api.coingecko.com/api/v3'
const timeout = 10_000

/** Demo network slug → CoinGecko asset platform id for /simple/token_price */
const NETWORK_PLATFORM: Record<string, string> = {
  eth: 'ethereum',
  ethereum: 'ethereum',
  bsc: 'binance-smart-chain',
  polygon: 'polygon-pos',
  arbitrum: 'arbitrum-one',
  base: 'base',
  avalanche: 'avalanche',
  solana: 'solana',
}

/** Common ticker → CoinGecko coin id (Demo API). */
export const COIN_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BNB: 'binancecoin',
  SOL: 'solana',
  XRP: 'ripple',
  DOGE: 'dogecoin',
  ADA: 'cardano',
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
  DOT: 'polkadot',
  HBAR: 'hedera-hashgraph',
  MATIC: 'matic-network',
  POL: 'polygon-ecosystem-token',
  ATOM: 'cosmos',
  LTC: 'litecoin',
  UNI: 'uniswap',
  AAVE: 'aave',
  PEPE: 'pepe',
  SHIB: 'shiba-inu',
}

const ID_TO_SYMBOL = Object.fromEntries(
  Object.entries(COIN_IDS).map(([symbol, id]) => [id, symbol]),
) as Record<string, string>

export type CoinGeckoMarket = {
  id: string
  symbol: string
  name: string
  price: number
  change1h?: number
  change24h: number
  change7d?: number
  change30d?: number
  volume24h: number
  marketCap?: number
  sparkline?: number[]
  rank?: number
}

export type CoinGeckoCategory = {
  id: string
  name: string
  marketCap?: number
  marketCapChange24h?: number
  volume24h?: number
}

export type CoinGeckoTokenPrice = {
  network: string
  address: string
  priceUsd: number
  change24h?: number
}

export type CoinGeckoCoinListItem = {
  id: string
  symbol: string
  name: string
  platforms: Record<string, string>
}

function coinId(symbol: string): string {
  const key = symbol.toUpperCase().replace(/[-_/]/g, '').replace(/(USDT|USD|USDC)$/, '')
  const id = COIN_IDS[key]
  if (!id) throw new FinalityError('provider_unavailable', `CoinGecko has no mapping for ${symbol}`, 503, true)
  return id
}

function withDemoKey(url: string, apiKey?: string): string {
  if (!apiKey) return url
  const join = url.includes('?') ? '&' : '?'
  return `${url}${join}x_cg_demo_api_key=${encodeURIComponent(apiKey)}`
}

async function getDemoJson(url: string, apiKey?: string) {
  try {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (apiKey) headers['x-cg-demo-api-key'] = apiKey
    const response = await fetch(withDemoKey(url, apiKey), {
      headers,
      signal: AbortSignal.timeout(timeout),
    })
    if (response.status === 429) throw new FinalityError('provider_rate_limited', 'CoinGecko rate limit reached', 503, true)
    if (!response.ok) throw new FinalityError('provider_unavailable', `CoinGecko returned ${response.status}`, 503, true)
    return response.json()
  } catch (error) {
    if (error instanceof FinalityError) throw error
    throw new FinalityError('provider_unavailable', 'CoinGecko is unavailable', 503, true)
  }
}

async function getProJson(pathAndQuery: string, proApiKey: string) {
  try {
    const response = await fetch(`${PRO_BASE}${pathAndQuery}`, {
      headers: {
        accept: 'application/json',
        'x-cg-pro-api-key': proApiKey,
      },
      signal: AbortSignal.timeout(timeout),
    })
    if (response.status === 429) throw new FinalityError('provider_rate_limited', 'CoinGecko Pro rate limit reached', 503, true)
    if (!response.ok) throw new FinalityError('provider_unavailable', `CoinGecko Pro returned ${response.status}`, 503, true)
    return response.json()
  } catch (error) {
    if (error instanceof FinalityError) throw error
    throw new FinalityError('provider_unavailable', 'CoinGecko Pro is unavailable', 503, true)
  }
}

const meta = (extra: string[] = []) => ({
  source: 'coingecko',
  provider: 'public-rest',
  asOf: new Date().toISOString(),
  freshnessSeconds: 60,
  limitations: ['CoinGecko Demo /coins/markets; may be delayed vs CEX', ...extra],
  availabilityTrack: 'quota-limited' as const,
  dataMode: 'live' as const,
  synthetic: false,
})

type MarketsRow = {
  id: string
  symbol: string
  name: string
  current_price?: number
  market_cap?: number
  total_volume?: number
  market_cap_rank?: number
  price_change_percentage_24h?: number
  price_change_percentage_1h_in_currency?: number
  price_change_percentage_24h_in_currency?: number
  price_change_percentage_7d_in_currency?: number
  price_change_percentage_30d_in_currency?: number
  sparkline_in_7d?: { price?: number[] }
}

function mapMarket(row: MarketsRow): CoinGeckoMarket {
  const mapped = ID_TO_SYMBOL[row.id]
  return {
    id: row.id,
    symbol: (mapped ?? row.symbol ?? '').toUpperCase(),
    name: row.name,
    price: Number(row.current_price ?? 0),
    change1h: row.price_change_percentage_1h_in_currency,
    change24h: Number(
      row.price_change_percentage_24h_in_currency ?? row.price_change_percentage_24h ?? 0,
    ),
    change7d: row.price_change_percentage_7d_in_currency,
    change30d: row.price_change_percentage_30d_in_currency,
    volume24h: Number(row.total_volume ?? 0),
    marketCap: row.market_cap != null ? Number(row.market_cap) : undefined,
    sparkline: row.sparkline_in_7d?.price,
    rank: row.market_cap_rank,
  }
}

function toQuote(m: CoinGeckoMarket): Quote {
  return {
    symbol: m.symbol,
    price: m.price,
    change24h: m.change24h,
    volume24h: m.volume24h,
    marketCap: m.marketCap,
    change1h: m.change1h,
    change7d: m.change7d,
    change30d: m.change30d,
    sparkline: m.sparkline,
    name: m.name,
  }
}

/**
 * CoinGecko Demo: GET /coins/markets
 * ids, sparkline, price_change_percentage=1h,24h,7d,30d
 */
export async function fetchCoinGeckoMarkets(
  ids: string[],
  apiKey = '',
): Promise<ProviderResult<CoinGeckoMarket[]>> {
  if (!ids.length) throw new FinalityError('provider_unavailable', 'No CoinGecko market ids', 503, true)
  const unique = [...new Set(ids)]
  const cacheKey = `coingecko:markets:${unique.sort().join(',')}:${apiKey ? 'keyed' : 'public'}`
  const rows = await cached(cacheKey, 30_000, () =>
    getDemoJson(
      `${DEMO_BASE}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(unique.join(','))}` +
        `&sparkline=true&price_change_percentage=${encodeURIComponent('1h,24h,7d,30d')}`,
      apiKey,
    ),
  ) as MarketsRow[]

  if (!Array.isArray(rows) || !rows.length) {
    throw new FinalityError('provider_unavailable', 'CoinGecko markets returned empty', 503, true)
  }
  return { data: rows.map(mapMarket), meta: meta(['Endpoint: /coins/markets']) }
}

/** Quotes via /coins/markets (primary market path — not Binance). */
export async function fetchCoinGeckoQuotes(symbols: string[], apiKey = ''): Promise<ProviderResult<Quote[]>> {
  const ids = symbols.map(coinId)
  const markets = await fetchCoinGeckoMarkets(ids, apiKey)
  const byId = new Map(markets.data.map(m => [m.id, m]))
  const data = symbols.map(symbol => {
    const id = coinId(symbol)
    const row = byId.get(id)
    if (!row || !(row.price > 0)) {
      throw new FinalityError('provider_unavailable', `CoinGecko missing market for ${symbol}`, 503, true)
    }
    return toQuote({ ...row, symbol: symbol.toUpperCase() })
  })
  return { data, meta: markets.meta }
}

/** Top markets by 24h volume — used for market.trending. */
export async function fetchCoinGeckoTrendingMarkets(
  limit: number,
  apiKey = '',
): Promise<ProviderResult<Quote[]>> {
  const perPage = Math.max(1, Math.min(50, limit))
  const cacheKey = `coingecko:trending-markets:${perPage}:${apiKey ? 'keyed' : 'public'}`
  const rows = await cached(cacheKey, 60_000, () =>
    getDemoJson(
      `${DEMO_BASE}/coins/markets?vs_currency=usd&order=volume_desc&per_page=${perPage}&page=1` +
        `&sparkline=true&price_change_percentage=${encodeURIComponent('1h,24h,7d,30d')}`,
      apiKey,
    ),
  ) as MarketsRow[]

  if (!Array.isArray(rows) || !rows.length) {
    throw new FinalityError('provider_unavailable', 'CoinGecko trending markets empty', 503, true)
  }
  const data = rows.map((row, i) => {
    const m = mapMarket(row)
    return { ...toQuote(m), rank: i + 1 }
  })
  return { data, meta: meta(['Endpoint: /coins/markets?order=volume_desc']) }
}

/** Demo: GET /coins/categories?order=market_cap_change_24h_desc */
export async function fetchCoinGeckoCategories(apiKey = ''): Promise<ProviderResult<CoinGeckoCategory[]>> {
  const rows = await cached(`coingecko:categories:${apiKey ? 'keyed' : 'public'}`, 300_000, () =>
    getDemoJson(
      `${DEMO_BASE}/coins/categories?order=market_cap_change_24h_desc`,
      apiKey,
    ),
  ) as Array<{
    id?: string
    name?: string
    market_cap?: number
    market_cap_change_24h?: number
    volume_24h?: number
  }>

  if (!Array.isArray(rows) || !rows.length) {
    throw new FinalityError('provider_unavailable', 'CoinGecko categories empty', 503, true)
  }

  return {
    data: rows.slice(0, 25).map(row => ({
      id: String(row.id ?? ''),
      name: String(row.name ?? ''),
      marketCap: row.market_cap != null ? Number(row.market_cap) : undefined,
      marketCapChange24h: row.market_cap_change_24h != null ? Number(row.market_cap_change_24h) : undefined,
      volume24h: row.volume_24h != null ? Number(row.volume_24h) : undefined,
    })),
    meta: meta(['Endpoint: /coins/categories']),
  }
}

/**
 * Token USD prices by contract.
 * Prefers Pro `/onchain/simple/networks/{network}/token_price/{addresses}` when proApiKey is set;
 * otherwise Demo `/simple/token_price/{platform}`.
 */
export async function fetchCoinGeckoTokenPrices(
  network: string,
  addresses: string[],
  options: { demoApiKey?: string; proApiKey?: string } = {},
): Promise<ProviderResult<CoinGeckoTokenPrice[]>> {
  const cleaned = [...new Set(addresses.map(a => a.trim().toLowerCase()).filter(Boolean))]
  if (!cleaned.length) {
    throw new FinalityError('provider_unavailable', 'No token addresses provided', 503, true)
  }
  const net = network.trim().toLowerCase() || 'eth'
  const keyed = options.proApiKey ? 'pro' : options.demoApiKey ? 'demo' : 'public'

  if (options.proApiKey) {
    const path = `/onchain/simple/networks/${encodeURIComponent(net)}/token_price/${cleaned.join(',')}`
    const payload = await cached(`coingecko:pro-token-price:${net}:${cleaned.join(',')}`, 30_000, () =>
      getProJson(path, options.proApiKey!),
    ) as { data?: { attributes?: { token_prices?: Record<string, string> } } } | Record<string, { usd?: number }>

    const prices =
      (payload as { data?: { attributes?: { token_prices?: Record<string, string> } } })?.data?.attributes?.token_prices ??
      (payload as Record<string, { usd?: number }>)

    const data: CoinGeckoTokenPrice[] = cleaned.map(address => {
      const raw =
        typeof prices?.[address] === 'object'
          ? Number((prices as Record<string, { usd?: number }>)[address]?.usd)
          : Number((prices as Record<string, string>)?.[address])
      if (!Number.isFinite(raw) || raw <= 0) {
        throw new FinalityError('provider_unavailable', `CoinGecko Pro missing price for ${address}`, 503, true)
      }
      return { network: net, address, priceUsd: raw }
    })
    return { data, meta: meta(['Endpoint: Pro /onchain/simple/networks/.../token_price']) }
  }

  const platform = NETWORK_PLATFORM[net]
  if (!platform) {
    throw new FinalityError('provider_unavailable', `Unsupported network for Demo token_price: ${network}`, 503, true)
  }

  // Demo/public plan often allows only 1 contract address per request — fetch in parallel batches of 1.
  const chunks = cleaned.map(address => [address])
  const merged: Record<string, { usd?: number; usd_24h_change?: number }> = {}
  await Promise.all(
    chunks.map(async chunk => {
      const rows = await cached(
        `coingecko:token-price:${platform}:${chunk.join(',')}:${keyed}`,
        30_000,
        () =>
          getDemoJson(
            `${DEMO_BASE}/simple/token_price/${encodeURIComponent(platform)}` +
              `?contract_addresses=${encodeURIComponent(chunk.join(','))}` +
              `&vs_currencies=usd&include_24hr_change=true`,
            options.demoApiKey,
          ),
      ) as Record<string, { usd?: number; usd_24h_change?: number }>
      Object.assign(merged, rows)
    }),
  )

  const data = cleaned.map(address => {
    const row = merged[address]
    const priceUsd = Number(row?.usd ?? 0)
    if (!(priceUsd > 0)) {
      throw new FinalityError('provider_unavailable', `CoinGecko missing token price for ${address}`, 503, true)
    }
    return {
      network: net,
      address,
      priceUsd,
      change24h: row?.usd_24h_change != null ? Number(row.usd_24h_change) : undefined,
    }
  })
  return {
    data,
    meta: meta([
      'Endpoint: Demo /simple/token_price/{platform}',
      'Addresses requested one-at-a-time to respect Demo contract limits',
    ]),
  }
}

/** Demo/Pro: GET /coins/list?include_platform=true */
export async function fetchCoinGeckoCoinsList(
  options: { demoApiKey?: string; proApiKey?: string } = {},
): Promise<ProviderResult<CoinGeckoCoinListItem[]>> {
  const keyed = options.proApiKey ? 'pro' : options.demoApiKey ? 'demo' : 'public'
  const rows = await cached(`coingecko:coins-list:${keyed}`, 3_600_000, async () => {
    if (options.proApiKey) {
      return getProJson('/coins/list?include_platform=true', options.proApiKey)
    }
    return getDemoJson(`${DEMO_BASE}/coins/list?include_platform=true`, options.demoApiKey)
  }) as Array<{ id?: string; symbol?: string; name?: string; platforms?: Record<string, string | null> }>

  if (!Array.isArray(rows) || !rows.length) {
    throw new FinalityError('provider_unavailable', 'CoinGecko coins list empty', 503, true)
  }

  return {
    data: rows.map(row => ({
      id: String(row.id ?? ''),
      symbol: String(row.symbol ?? '').toUpperCase(),
      name: String(row.name ?? ''),
      platforms: Object.fromEntries(
        Object.entries(row.platforms ?? {})
          .filter(([, addr]) => Boolean(addr))
          .map(([k, addr]) => [k, String(addr)]),
      ),
    })),
    meta: meta([
      options.proApiKey
        ? 'Endpoint: Pro /coins/list?include_platform=true'
        : 'Endpoint: Demo /coins/list?include_platform=true',
    ]),
  }
}

function daysForInterval(interval: string, limit: number): number {
  const minutes =
    interval === '1m' ? 1 :
    interval === '5m' ? 5 :
    interval === '15m' ? 15 :
    interval === '1h' ? 60 :
    interval === '4h' ? 240 :
    1440
  const spanDays = Math.ceil((minutes * Math.max(limit, 2)) / (60 * 24))
  if (spanDays <= 1) return 1
  if (spanDays <= 7) return 7
  if (spanDays <= 14) return 14
  if (spanDays <= 30) return 30
  if (spanDays <= 90) return 90
  return 180
}

export async function fetchCoinGeckoCandles(
  symbol: string,
  interval: string,
  limit: number,
  apiKey = '',
): Promise<ProviderResult<Candle[]>> {
  const id = coinId(symbol)
  const days = daysForInterval(interval, limit)
  const keyed = apiKey ? 'keyed' : 'public'

  try {
    const rows = await cached(`coingecko:ohlc:${id}:${days}:${keyed}`, 60_000, () =>
      getDemoJson(`${DEMO_BASE}/coins/${encodeURIComponent(id)}/ohlc?vs_currency=usd&days=${days}`, apiKey),
    ) as number[][]

    if (Array.isArray(rows) && rows.length > 0) {
      return {
        data: rows.slice(-Math.max(2, limit)).map(row => ({
          time: Number(row[0]),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: 0,
        })),
        meta: meta([
          'Endpoint: /coins/{id}/ohlc',
          'OHLC volume unavailable (volume=0)',
          `Granularity follows days=${days}, not exact ${interval} bins`,
        ]),
      }
    }
  } catch {
    /* market_chart fallback */
  }

  const chart = await cached(`coingecko:chart:${id}:${days}:${keyed}`, 60_000, () =>
    getDemoJson(
      `${DEMO_BASE}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}`,
      apiKey,
    ),
  ) as { prices?: number[][]; total_volumes?: number[][] }

  const prices = chart.prices ?? []
  if (prices.length < 2) {
    throw new FinalityError('provider_unavailable', `CoinGecko returned no chart data for ${symbol}`, 503, true)
  }

  const volumes = new Map((chart.total_volumes ?? []).map(([t, v]) => [Number(t), Number(v)]))
  const step = Math.max(1, Math.floor(prices.length / Math.max(limit, 2)))
  const candles: Candle[] = []
  for (let i = 0; i < prices.length; i += step) {
    const chunk = prices.slice(i, Math.min(prices.length, i + step))
    if (!chunk.length) continue
    const vals = chunk.map(row => Number(row[1]))
    const open = vals[0]
    const close = vals.at(-1) ?? open
    candles.push({
      time: Number(chunk[0][0]),
      open,
      high: Math.max(...vals),
      low: Math.min(...vals),
      close,
      volume: volumes.get(Number(chunk[0][0])) ?? 0,
    })
  }

  return {
    data: candles.slice(-Math.max(2, limit)),
    meta: meta([
      'Endpoint: /coins/{id}/market_chart (synthesized candles)',
      `Approx granularity for days=${days}, not exact ${interval} bins`,
    ]),
  }
}
