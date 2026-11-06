/**
 * Smoke CoinGecko Demo markets / categories / token_price / candles.
 * Usage: COINGECKO_API_KEY=... npx tsx scripts/smoke-coingecko.ts
 */
import {
  fetchMarketQuotes,
  fetchMarketCandles,
  fetchMarketTrending,
  fetchMarketCategories,
  fetchMarketTokenPrices,
} from '../lib/providers/market'

async function main() {
  const key = process.env.COINGECKO_API_KEY || ''
  const opts = { coingeckoApiKey: key, coingeckoProApiKey: process.env.COINGECKO_PRO_API_KEY || '' }

  const q = await fetchMarketQuotes(['BTC', 'ETH', 'SOL'], opts)
  console.log('quotes', q.meta.source, q.data.map(d => ({
    s: d.symbol,
    p: d.price,
    c1h: d.change1h,
    c24: d.change24h,
    c7d: d.change7d,
    spark: d.sparkline?.length,
  })))

  const t = await fetchMarketTrending(5, opts)
  console.log('trending', t.data.map(d => d.symbol))

  const c = await fetchMarketCandles('BTC', '1h', 24, opts)
  console.log('candles', c.meta.source, c.data.length, c.meta.limitations?.[0])

  const cats = await fetchMarketCategories(opts)
  console.log('categories', cats.data.slice(0, 3).map(x => ({ name: x.name, chg: x.marketCapChange24h })))

  const tokens = await fetchMarketTokenPrices(
    'eth',
    [
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      '0x6b175474e89094c44da98b954eedeac495271d0f',
    ],
    opts,
  )
  console.log('tokenPrices', tokens.meta.limitations?.[0], tokens.data)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
