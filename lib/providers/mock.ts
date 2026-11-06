import type { Candle, ProviderResult, Quote } from './types'

function hash(value: string) {
  let h = 2166136261
  for (const ch of value) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return Math.abs(h >>> 0)
}

export function mockMeta(reason: 'missing_credentials' | 'invalid_credentials' | 'quota_exhausted' | 'rate_limited' | 'timeout' | 'upstream_error' | 'model_unavailable' = 'upstream_error') {
  return {
    source: 'finality-deterministic-fixture', provider: 'internal',
    asOf: '2026-01-01T00:00:00.000Z', freshnessSeconds: 0,
    limitations: ['Synthetic test data only; not current market information'],
    availabilityTrack: 'durable' as const, dataMode: 'mock' as const,
    synthetic: true, fallback: true, fallbackReason: reason,
  }
}

export function mockQuotes(symbols: string[], reason: Parameters<typeof mockMeta>[0] = 'upstream_error'): ProviderResult<Quote[]> {
  return { data: symbols.map(symbol => {
    const n = hash(symbol.toUpperCase())
    return { symbol: symbol.toUpperCase(), price: Number((10 + n % 50000 + (n % 99) / 100).toFixed(2)), change24h: Number((((n % 1600) - 800) / 100).toFixed(2)), volume24h: 1_000_000 + n % 900_000_000, marketCap: 10_000_000 + n % 90_000_000_000 }
  }), meta: mockMeta(reason) }
}

export function mockCandles(symbol: string, limit = 100, reason: Parameters<typeof mockMeta>[0] = 'upstream_error'): ProviderResult<Candle[]> {
  const seed = hash(symbol)
  const start = 1_700_000_000_000
  const data = Array.from({ length: limit }, (_, i) => {
    const base = 50 + (seed % 1000) / 10 + i * .12 + Math.sin(i / 5) * 2
    return { time: start + i * 3_600_000, open: base, high: base + 1.2, low: base - 1.1, close: base + Math.sin(i) * .5, volume: 100_000 + ((seed + i * 7919) % 500_000) }
  })
  return { data, meta: mockMeta(reason) }
}
