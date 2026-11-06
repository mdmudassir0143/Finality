import type { ResponseMeta } from '../contracts/api'

export interface ProviderResult<T> { data: T; meta: ResponseMeta }
export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }
export interface Quote {
  symbol: string
  price: number
  change24h: number
  volume24h: number
  marketCap?: number
  name?: string
  change1h?: number
  change7d?: number
  change30d?: number
  sparkline?: number[]
  rank?: number
}
