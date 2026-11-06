export type DataMode = 'live' | 'mock'

export interface ResponseMeta {
  source: string
  provider: string
  asOf: string
  freshnessSeconds: number
  limitations: string[]
  availabilityTrack: 'durable' | 'quota-limited'
  dataMode: DataMode
  synthetic: boolean
  fallback?: boolean
  fallbackReason?: 'missing_credentials' | 'invalid_credentials' | 'quota_exhausted' | 'rate_limited' | 'timeout' | 'upstream_error' | 'model_unavailable'
}

export interface SuccessEnvelope<T = unknown> {
  success: true
  operationId: string
  requestId: string
  data: T
  meta: ResponseMeta
  payment?: { network: string; asset: 'USDC'; settlementId: string }
}

export interface ErrorEnvelope {
  success: false
  operationId?: string
  requestId: string
  error: { code: string; message: string; retryable?: boolean; details?: unknown }
}
