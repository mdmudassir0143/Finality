import { pushLog } from './state.js'

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function randomInt(min: number, max: number): number {
  if (max < min) throw new Error('max must be >= min')
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Human-looking inter-call jitter for the paid traffic loop.
 * Bias toward mid/shorter waits, with occasional longer "think" pauses,
 * so the cadence is not a flat machine tick.
 */
export function humanDelayMs(min: number, max: number): number {
  if (max < min) throw new Error('max must be >= min')
  if (min === max) return min
  // ~12% of the time: longer idle (up to ~2.5× the configured max, capped +2m)
  if (Math.random() < 0.12) {
    const longMax = Math.min(max * 2.5, max + 120_000)
    return randomInt(max, Math.max(max, Math.floor(longMax)))
  }
  // Power curve: more mass toward shorter delays inside [min, max]
  const t = Math.random() ** 1.35
  return Math.round(min + t * (max - min))
}

export function pickRandom<T>(items: readonly T[]): T {
  if (!items.length) throw new Error('Cannot pick from empty list')
  return items[randomInt(0, items.length - 1)]!
}

/** Fisher–Yates shuffle (new array). */
export function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(0, i)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

export function log(event: string, data: Record<string, unknown> = {}): void {
  const line = { ts: new Date().toISOString(), event, ...data }
  console.log(JSON.stringify(line))
  pushLog({
    level: 'event',
    event,
    message: event,
    data,
    ts: line.ts,
  })
}

export function banner(title: string): void {
  console.log('')
  console.log('════════════════════════════════════════')
  console.log(`  ${title}`)
  console.log('════════════════════════════════════════')
  pushLog({ level: 'info', message: title })
}

export function msg(text: string): void {
  console.log(`[keeper] ${text}`)
  pushLog({ level: 'info', message: text })
}

export function ok(text: string): void {
  console.log(`[keeper] ✓ ${text}`)
  pushLog({ level: 'ok', message: text })
}

export function warn(text: string): void {
  console.warn(`[keeper] ! ${text}`)
  pushLog({ level: 'warn', message: text })
}

export function fail(text: string): void {
  console.error(`[keeper] ✗ ${text}`)
  pushLog({ level: 'fail', message: text })
}

export function toBaseUnits(amount: number, decimals: number): bigint {
  const [whole, frac = ''] = String(amount).split('.')
  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals)
  return BigInt(whole + padded)
}
