import type { PaidEndpoint } from './endpoints.js'

export type LogLevel = 'info' | 'ok' | 'warn' | 'fail' | 'event'

export type KeeperLogEntry = {
  ts: string
  level: LogLevel
  message: string
  event?: string
  data?: Record<string, unknown>
}

export type RouteStats = {
  operationId: string
  method: string
  path: string
  price: string
  calls: number
  ok: number
  fail: number
  lastStatus?: number
  lastError?: string
  lastAt?: string
  lastReceipt?: boolean
}

export type LoopSnapshot = {
  running: boolean
  startedAt?: string
  calls: number
  ok: number
  fail: number
  readyWallets: number
  totalWallets: number
  baseUrl: string
  minDelayMs: number
  maxDelayMs: number
  maxCalls: number | 'forever'
}

const MAX_LOGS = 200

const logs: KeeperLogEntry[] = []
const routeStats = new Map<string, RouteStats>()

let loop: LoopSnapshot = {
  running: false,
  calls: 0,
  ok: 0,
  fail: 0,
  readyWallets: 0,
  totalWallets: 0,
  baseUrl: '',
  minDelayMs: 0,
  maxDelayMs: 1,
  maxCalls: 'forever',
}

export function pushLog(entry: Omit<KeeperLogEntry, 'ts'> & { ts?: string }): void {
  logs.push({
    ts: entry.ts ?? new Date().toISOString(),
    level: entry.level,
    message: entry.message,
    ...(entry.event ? { event: entry.event } : {}),
    ...(entry.data ? { data: entry.data } : {}),
  })
  if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS)
}

export function getLogs(limit = 50): KeeperLogEntry[] {
  const n = Math.max(1, Math.min(MAX_LOGS, limit))
  return logs.slice(-n)
}

export function initRouteStats(endpoints: readonly PaidEndpoint[]): void {
  routeStats.clear()
  for (const endpoint of endpoints) {
    routeStats.set(endpoint.operationId, {
      operationId: endpoint.operationId,
      method: endpoint.method,
      path: endpoint.path,
      price: endpoint.price,
      calls: 0,
      ok: 0,
      fail: 0,
    })
  }
}

export function recordRouteResult(
  endpoint: PaidEndpoint,
  result: { status: number; receipt?: boolean; error?: string; ok: boolean },
): void {
  const row =
    routeStats.get(endpoint.operationId) ??
    ({
      operationId: endpoint.operationId,
      method: endpoint.method,
      path: endpoint.path,
      price: endpoint.price,
      calls: 0,
      ok: 0,
      fail: 0,
    } satisfies RouteStats)

  row.calls += 1
  if (result.ok) row.ok += 1
  else row.fail += 1
  row.lastStatus = result.status
  row.lastAt = new Date().toISOString()
  row.lastReceipt = result.receipt
  if (result.error) row.lastError = result.error
  else delete row.lastError
  routeStats.set(endpoint.operationId, row)
}

export function getRouteStats(): RouteStats[] {
  return [...routeStats.values()].sort((a, b) => a.operationId.localeCompare(b.operationId))
}

export function setLoopSnapshot( partial: Partial<LoopSnapshot>): void {
  loop = { ...loop, ...partial }
}

export function getLoopSnapshot(): LoopSnapshot {
  return { ...loop }
}

/** Runtime endpoint filter (UI dropdown + custom operation ids). */
const FILTER_PRESETS = ['onchain', 'pro', 'onchain,pro', 'intelligence.signals'] as const
export type EndpointFilterPreset = (typeof FILTER_PRESETS)[number]

let endpointFilter: string = 'onchain,pro'

export function getEndpointFilter(): string {
  return endpointFilter
}

export function listEndpointFilterPresets(): EndpointFilterPreset[] {
  return [...FILTER_PRESETS]
}

export function normalizeEndpointFilter(raw: string): string {
  const v = raw.trim().toLowerCase().replace(/\s+/g, '')
  if (v === 'both' || v === 'all-active' || v === 'onchain+pro') return 'onchain,pro'
  if (v === 'onchain,pro' || v === 'pro,onchain') return 'onchain,pro'
  if (v === 'onchain' || v === 'pro') return v
  if (v === 'intelligence.signals' || v === 'signals') return 'intelligence.signals'
  // Allow exact operation ids / comma lists that activeEndpoints understands
  if (v.includes('.') || v.includes(',')) return v
  throw new Error(
    `Invalid filter "${raw}". Use: onchain | pro | onchain,pro | intelligence.signals`,
  )
}

export function setEndpointFilter(raw: string): string {
  const next = normalizeEndpointFilter(raw)
  endpointFilter = next
  return next
}

/** Runtime delay range (UI dropdown). */
export type DelayPreset = {
  id: string
  label: string
  minDelayMs: number
  maxDelayMs: number
}

export const DELAY_PRESETS: DelayPreset[] = [
  { id: '1s-3s', label: '1–3 sec (exhaust)', minDelayMs: 1_000, maxDelayMs: 3_000 },
  { id: '3s-8s', label: '3–8 sec (fast)', minDelayMs: 3_000, maxDelayMs: 8_000 },
  { id: '30s-2m', label: '30 sec – 2 min', minDelayMs: 30_000, maxDelayMs: 120_000 },
  { id: '30s-3m', label: '30 sec – 3 min', minDelayMs: 30_000, maxDelayMs: 180_000 },
  { id: '1m-5m', label: '1 min – 5 min', minDelayMs: 60_000, maxDelayMs: 300_000 },
  { id: '30s-1.5m', label: '30 sec – 1.5 min', minDelayMs: 30_000, maxDelayMs: 90_000 },
]

let delayPresetId = '30s-2m'
let minDelayMs = 30_000
let maxDelayMs = 120_000

export function getDelayRange(): { id: string; minDelayMs: number; maxDelayMs: number; label: string } {
  const preset = DELAY_PRESETS.find((p) => p.id === delayPresetId)
  return {
    id: delayPresetId,
    minDelayMs,
    maxDelayMs,
    label: preset?.label ?? `${minDelayMs}–${maxDelayMs}ms`,
  }
}

export function listDelayPresets(): DelayPreset[] {
  return DELAY_PRESETS.map((p) => ({ ...p }))
}

export function setDelayPreset(idOrLabel: string): DelayPreset {
  const raw = idOrLabel.trim().toLowerCase()
  const preset =
    DELAY_PRESETS.find((p) => p.id === raw) ||
    DELAY_PRESETS.find((p) => p.label.toLowerCase() === raw) ||
    DELAY_PRESETS.find((p) => p.id.replace(/-/g, '') === raw.replace(/[\s–—-]/g, ''))
  if (!preset) {
    throw new Error(
      `Invalid delay preset "${idOrLabel}". Use: ${DELAY_PRESETS.map((p) => p.id).join(' | ')}`,
    )
  }
  delayPresetId = preset.id
  minDelayMs = preset.minDelayMs
  maxDelayMs = preset.maxDelayMs
  return { ...preset }
}

/** Seed delay from env MIN/MAX — exact preset match, else custom values. */
export function seedDelayFromConfig(minMs: number, maxMs: number): DelayPreset {
  const exact = DELAY_PRESETS.find((p) => p.minDelayMs === minMs && p.maxDelayMs === maxMs)
  if (exact) return setDelayPreset(exact.id)
  delayPresetId = 'custom'
  minDelayMs = minMs
  maxDelayMs = maxMs
  return {
    id: 'custom',
    label: `${minMs}–${maxMs}ms`,
    minDelayMs: minMs,
    maxDelayMs: maxMs,
  }
}
