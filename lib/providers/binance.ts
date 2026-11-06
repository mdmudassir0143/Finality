import { FinalityError } from '../contracts/errors'
import type { Candle, ProviderResult, Quote } from './types'
import { cached } from './cache'

const BASE = 'https://api.binance.com/api/v3'
const timeout = 8_000
const symbolPair = (s: string) => s.toUpperCase().replace(/[-_/]/g, '').replace(/USDT$/, '') + 'USDT'

async function getJson(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout) })
    if (response.status === 429) throw new FinalityError('provider_rate_limited', 'Binance rate limit reached', 503, true)
    if (!response.ok) throw new FinalityError('provider_unavailable', `Binance returned ${response.status}`, 503, true)
    return response.json()
  } catch (error) {
    if (error instanceof FinalityError) throw error
    throw new FinalityError('provider_unavailable', 'Binance is unavailable', 503, true)
  }
}

const meta = () => ({ source: 'binance', provider: 'public-rest', asOf: new Date().toISOString(), freshnessSeconds: 15, limitations: ['Crypto spot markets only'], availabilityTrack: 'durable' as const, dataMode: 'live' as const, synthetic: false })

export async function fetchBinanceQuotes(symbols: string[]): Promise<ProviderResult<Quote[]>> {
  const data = await Promise.all(symbols.map(async symbol => cached(`binance:quote:${symbol.toUpperCase()}`,15_000,async()=> {
    const ticker = await getJson(`${BASE}/ticker/24hr?symbol=${encodeURIComponent(symbolPair(symbol))}`) as any
    return { symbol: symbol.toUpperCase(), price: Number(ticker.lastPrice), change24h: Number(ticker.priceChangePercent), volume24h: Number(ticker.quoteVolume) }
  })))
  return { data, meta: meta() }
}

export async function fetchBinanceCandles(symbol: string, interval: string, limit: number): Promise<ProviderResult<Candle[]>> {
  const rows = await cached(`binance:candles:${symbolPair(symbol)}:${interval}:${limit}`,15_000,()=>getJson(`${BASE}/klines?symbol=${encodeURIComponent(symbolPair(symbol))}&interval=${encodeURIComponent(interval)}&limit=${limit}`)) as any[]
  return { data: rows.map(row => ({ time: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) })), meta: meta() }
}
