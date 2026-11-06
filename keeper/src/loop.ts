import type { KeeperConfig } from './config.js'
import { accountBalances } from './hedera.js'
import { activeEndpoints, type PaidEndpoint } from './endpoints.js'
import {
  initRouteStats,
  recordRouteResult,
  setLoopSnapshot,
  getEndpointFilter,
  getDelayRange,
} from './state.js'
import { banner, fail, log, msg, ok, pickRandom, humanDelayMs, warn } from './util.js'
import { loadWallets } from './wallets.js'
import { callPaidEndpoint } from './x402.js'

function endpointPrice(endpoint: PaidEndpoint): number {
  return Number(endpoint.price.replace('$', ''))
}

function affordableEndpoints(endpoints: PaidEndpoint[], usdcBalance: number): PaidEndpoint[] {
  // Leave a tiny headroom so dust / fee rounding does not brick the last call.
  const spendable = Math.max(0, usdcBalance - 0.01)
  return endpoints.filter((e) => endpointPrice(e) <= spendable)
}

async function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function readyWallets(store: Awaited<ReturnType<typeof loadWallets>>) {
  return store.wallets.filter(
    (w) => w.accountId && w.fundedHbar && w.fundedUsdc && w.associatedUsdc,
  )
}

/**
 * Forever loop: random funded wallet × filtered paid endpoint × human-jitter delay.
 * Pass an AbortSignal to stop from the control UI / API.
 */
export async function runRandomLoop(config: KeeperConfig, signal?: AbortSignal): Promise<void> {
  banner('Random x402 traffic loop')
  const store = await loadWallets(config)
  let ready = readyWallets(store)
  if (!ready.length) {
    setLoopSnapshot({ running: false, readyWallets: 0, totalWallets: store.wallets.length })
    throw new Error('No funded wallets. Run: npm run fund')
  }

  const endpoints = activeEndpoints(getEndpointFilter())
  const delay = getDelayRange()
  initRouteStats(endpoints)
  setLoopSnapshot({
    running: true,
    startedAt: new Date().toISOString(),
    calls: 0,
    ok: 0,
    fail: 0,
    readyWallets: ready.length,
    totalWallets: store.wallets.length,
    baseUrl: config.X402_BASE_URL,
    minDelayMs: delay.minDelayMs,
    maxDelayMs: delay.maxDelayMs,
    maxCalls: config.MAX_CALLS || 'forever',
  })

  msg(`mode=controllable  filter=${getEndpointFilter()}  routes=${endpoints.map((e) => e.operationId).join(',')}`)
  msg(`ready wallets=${ready.length}/${store.wallets.length}  (only fully funded wallets are used)`)
  if (ready.length < store.wallets.length) {
    warn(
      `${store.wallets.length - ready.length} wallets still unfunded — top up funders then npm run fund to unlock the fleet`,
    )
  }
  msg(`base=${config.X402_BASE_URL}  network=${config.X402_NETWORK}`)
  msg(
    `delay=${delay.label} (${delay.minDelayMs}–${delay.maxDelayMs}ms)  maxCalls=${config.MAX_CALLS || 'forever'}`,
  )
  log('loop.start', {
    wallets: ready.length,
    totalWallets: store.wallets.length,
    endpoints: endpoints.length,
    endpointFilter: getEndpointFilter(),
    delayPreset: delay.id,
    baseUrl: config.X402_BASE_URL,
    network: config.X402_NETWORK,
    minDelayMs: delay.minDelayMs,
    maxDelayMs: delay.maxDelayMs,
    maxCalls: config.MAX_CALLS || 'forever',
    healthPort: config.HEALTH_PORT,
    routes: endpoints.map((e) => `${e.method} ${e.path}`),
    random: ['wallet', 'endpoint', 'delay'],
  })

  let calls = 0
  let okCount = 0
  let failCount = 0

  while (!signal?.aborted) {
    if (config.MAX_CALLS > 0 && calls >= config.MAX_CALLS) {
      ok(`stopped after maxCalls=${config.MAX_CALLS}  ok=${okCount}  fail=${failCount}`)
      setLoopSnapshot({ running: false, calls, ok: okCount, fail: failCount })
      log('loop.stop', { reason: 'max-calls', calls, ok: okCount, fail: failCount })
      break
    }

    if (calls > 0 && calls % 25 === 0) {
      try {
        const latest = await loadWallets(config)
        ready = readyWallets(latest)
        setLoopSnapshot({ readyWallets: ready.length, totalWallets: latest.wallets.length })
      } catch {
        /* keep prior ready list */
      }
    }

    const wallet = pickRandom(ready)
    let candidates = endpoints
    try {
      const bal = await accountBalances(config, wallet.accountId, config.USDC_TOKEN_ID)
      const affordable = affordableEndpoints(endpoints, bal.usdc)
      if (!affordable.length) {
        warn(
          `wallet #${wallet.index} USDC=${bal.usdc.toFixed(2)} cannot afford any filtered route — skipping`,
        )
        log('loop.call.skip', { wallet: wallet.index, usdc: bal.usdc, reason: 'insufficient-usdc' })
        await sleepUnlessAborted(
          humanDelayMs(getDelayRange().minDelayMs, getDelayRange().maxDelayMs),
          signal ?? new AbortController().signal,
        )
        continue
      }
      candidates = affordable
    } catch (error) {
      warn(
        `wallet #${wallet.index} balance check failed — using full filter (${error instanceof Error ? error.message : error})`,
      )
    }

    const endpoint = pickRandom(candidates)
    const delayMs = humanDelayMs(getDelayRange().minDelayMs, getDelayRange().maxDelayMs)

    msg(
      `call #${calls + 1}  random wallet=#${wallet.index}  random ${endpoint.method} ${endpoint.path}  price=${endpoint.price}  delay=${delayMs}ms`,
    )
    log('loop.call.start', {
      wallet: wallet.index,
      accountId: wallet.accountId,
      operationId: endpoint.operationId,
      method: endpoint.method,
      path: endpoint.path,
      usdcPrice: endpoint.price,
      delayMs,
    })

    try {
      const result = await callPaidEndpoint(config.X402_BASE_URL, wallet, endpoint)
      calls += 1
      if (result.error) {
        failCount += 1
        fail(`HTTP ${result.status}  ${endpoint.operationId}  ${result.error}`)
        recordRouteResult(endpoint, {
          status: result.status,
          receipt: result.receipt,
          error: result.error,
          ok: false,
        })
        setLoopSnapshot({ calls, ok: okCount, fail: failCount })
        log('loop.call.fail', { calls, wallet: wallet.index, ...result, totals: { ok: okCount, fail: failCount } })
      } else {
        okCount += 1
        ok(
          `${endpoint.operationId}  wallet=#${wallet.index}  status=${result.status}  receipt=${result.receipt}  paid=${result.usdcPrice} USDC  ok=${okCount} fail=${failCount}`,
        )
        recordRouteResult(endpoint, {
          status: result.status,
          receipt: result.receipt,
          ok: true,
        })
        setLoopSnapshot({ calls, ok: okCount, fail: failCount })
        log('loop.call.ok', {
          calls,
          wallet: wallet.index,
          accountId: wallet.accountId,
          ...result,
          totals: { ok: okCount, fail: failCount },
        })
      }
    } catch (error) {
      calls += 1
      failCount += 1
      const message = error instanceof Error ? error.message : String(error)
      fail(`${endpoint.operationId}  wallet=#${wallet.index}  ${message}`)
      warn(`totals ok=${okCount} fail=${failCount}`)
      recordRouteResult(endpoint, { status: 0, error: message, ok: false })
      setLoopSnapshot({ calls, ok: okCount, fail: failCount })
      log('loop.call.error', {
        calls,
        wallet: wallet.index,
        operationId: endpoint.operationId,
        error: message,
        totals: { ok: okCount, fail: failCount },
      })
    }

    if (signal?.aborted) break
    log('loop.wait', { delayMs })
    await sleepUnlessAborted(delayMs, signal ?? new AbortController().signal)
  }

  setLoopSnapshot({ running: false, calls, ok: okCount, fail: failCount })
  if (signal?.aborted) {
    ok(`loop aborted  ok=${okCount}  fail=${failCount}`)
    log('loop.stop', { reason: 'aborted', calls, ok: okCount, fail: failCount })
  }
}
