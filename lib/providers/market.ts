import type { Candle, ProviderResult, Quote } from './types'
import {
  fetchCoinGeckoCandles,
  fetchCoinGeckoQuotes,
  fetchCoinGeckoTrendingMarkets,
  fetchCoinGeckoCategories,
  fetchCoinGeckoTokenPrices,
  fetchCoinGeckoCoinsList,
} from './coingecko'
import { fetchDexScreenerQuotes, fetchDexScreenerTrending } from './dexscreener'

export type MarketProviderOptions = {
  coingeckoApiKey?: string
  coingeckoProApiKey?: string
}

/**
 * Live market quotes — CoinGecko Demo `/coins/markets` primary, DexScreener secondary.
 * Binance is not used.
 */
export async function fetchMarketQuotes(
  symbols: string[],
  options: MarketProviderOptions = {},
): Promise<ProviderResult<Quote[]>> {
  try {
    return await fetchCoinGeckoQuotes(symbols, options.coingeckoApiKey)
  } catch (coingeckoError) {
    try {
      return await fetchDexScreenerQuotes(symbols)
    } catch {
      throw coingeckoError
    }
  }
}

/** Trending by 24h volume via CoinGecko markets; DexScreener fallback. */
export async function fetchMarketTrending(
  limit: number,
  options: MarketProviderOptions = {},
): Promise<ProviderResult<Quote[]>> {
  try {
    return await fetchCoinGeckoTrendingMarkets(limit, options.coingeckoApiKey)
  } catch (coingeckoError) {
    try {
      return await fetchDexScreenerTrending(limit)
    } catch {
      throw coingeckoError
    }
  }
}

export async function fetchMarketCategories(options: MarketProviderOptions = {}) {
  return fetchCoinGeckoCategories(options.coingeckoApiKey)
}

/** Contract token USD prices — Pro onchain when keyed, else Demo simple/token_price. */
export async function fetchMarketTokenPrices(
  network: string,
  addresses: string[],
  options: MarketProviderOptions = {},
) {
  return fetchCoinGeckoTokenPrices(network, addresses, {
    demoApiKey: options.coingeckoApiKey,
    proApiKey: options.coingeckoProApiKey,
  })
}

export async function fetchMarketCoinsList(options: MarketProviderOptions = {}) {
  return fetchCoinGeckoCoinsList({
    demoApiKey: options.coingeckoApiKey,
    proApiKey: options.coingeckoProApiKey,
  })
}

/** Live OHLCV — CoinGecko Demo only. */
export async function fetchMarketCandles(
  symbol: string,
  interval: string,
  limit: number,
  options: MarketProviderOptions = {},
): Promise<ProviderResult<Candle[]>> {
  return fetchCoinGeckoCandles(symbol, interval, limit, options.coingeckoApiKey)
}
