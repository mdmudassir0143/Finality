import type { KeeperConfig } from './config.js'
import { runRandomLoop } from './loop.js'
import { getLoopSnapshot, setLoopSnapshot } from './state.js'
import { log, msg, ok, sleep, warn } from './util.js'

let abort: AbortController | null = null
let runningPromise: Promise<void> | null = null
let lastError: string | undefined

export function isLoopRunning(): boolean {
  return Boolean(abort) && getLoopSnapshot().running
}

export function getControllerError(): string | undefined {
  return lastError
}

export async function startLoop(config: KeeperConfig): Promise<{ ok: boolean; error?: string }> {
  if (abort || runningPromise) {
    return { ok: false, error: 'loop already running' }
  }

  // Re-seed on every Start (Docker ephemeral disk / UI Start after wipe).
  try {
    const { ensureWalletsSeeded } = await import('./seed.js')
    await ensureWalletsSeeded(config)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }

  lastError = undefined
  abort = new AbortController()
  const signal = abort.signal
  msg('loop start requested')
  log('loop.control', { action: 'start' })

  runningPromise = runRandomLoop(config, signal)
    .catch((error) => {
      if (signal.aborted) return
      const message = error instanceof Error ? error.message : String(error)
      lastError = message
      warn(`loop crashed: ${message}`)
      log('loop.crash', { error: message })
      setLoopSnapshot({ running: false })
    })
    .finally(() => {
      abort = null
      runningPromise = null
      if (getLoopSnapshot().running) setLoopSnapshot({ running: false })
    })

  for (let i = 0; i < 80; i++) {
    if (getLoopSnapshot().running) {
      ok('loop started')
      return { ok: true }
    }
    if (lastError) return { ok: false, error: lastError }
    if (!runningPromise) return { ok: false, error: lastError || 'loop exited during start' }
    await sleep(100)
  }

  // Still booting (slow wallet load) — treat as started if controller holds the lock
  if (abort) {
    ok('loop starting…')
    return { ok: true }
  }
  return { ok: false, error: lastError || 'loop failed to start' }
}

export async function stopLoop(): Promise<{ ok: boolean; error?: string }> {
  if (!abort) {
    setLoopSnapshot({ running: false })
    return { ok: false, error: 'loop is not running' }
  }
  msg('loop stop requested')
  log('loop.control', { action: 'stop' })
  abort.abort()
  setLoopSnapshot({ running: false })
  try {
    await Promise.race([runningPromise, sleep(5_000)])
  } catch {
    /* ignore */
  }
  ok('loop stopped')
  return { ok: true }
}
