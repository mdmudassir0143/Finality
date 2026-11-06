import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { accountBalances } from './hedera.js'
import type { KeeperConfig } from './config.js'
import { getControllerError, isLoopRunning, startLoop, stopLoop } from './controller.js'
import { activeEndpoints } from './endpoints.js'
import {
  getDelayRange,
  getEndpointFilter,
  getLogs,
  getLoopSnapshot,
  getRouteStats,
  initRouteStats,
  listDelayPresets,
  listEndpointFilterPresets,
  pushLog,
  seedDelayFromConfig,
  setDelayPreset,
  setEndpointFilter,
} from './state.js'
import { log, msg, ok } from './util.js'
import { loadFunders, loadWallets } from './wallets.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const uiPath = join(__dirname, '../public/index.html')

function cors(res: ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
  res.setHeader('access-control-allow-headers', 'Content-Type,Authorization')
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2)
  cors(res)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(payload)
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  cors(res)
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(html)
}

function readLimit(req: IncomingMessage, fallback = 50): number {
  try {
    const url = new URL(req.url || '/', 'http://localhost')
    const raw = url.searchParams.get('limit')
    if (!raw) return fallback
    const n = Number(raw)
    return Number.isFinite(n) ? Math.max(1, Math.min(200, Math.floor(n))) : fallback
  } catch {
    return fallback
  }
}

function bearerToken(req: IncomingMessage): string {
  const header = req.headers.authorization || ''
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim()
  try {
    return new URL(req.url || '/', 'http://localhost').searchParams.get('token') || ''
  } catch {
    return ''
  }
}

function requireControl(config: KeeperConfig, req: IncomingMessage, res: ServerResponse): boolean {
  const expected = config.KEEPER_CONTROL_TOKEN.trim()
  if (!expected) return true
  if (bearerToken(req) === expected) return true
  sendJson(res, 401, { ok: false, error: 'unauthorized — set Authorization: Bearer <KEEPER_CONTROL_TOKEN>' })
  return false
}

async function buildHealth(config: KeeperConfig, req: IncomingMessage) {
  const loop = getLoopSnapshot()
  const routes = getRouteStats()
  const recentLogs = getLogs(readLimit(req, 50))
  const catalog = activeEndpoints(getEndpointFilter())

  let wallets: {
    total: number
    ready: number
    fundedHbar: number
    fundedUsdc: number
    associatedUsdc: number
  } | null = null
  let walletsError: string | undefined

  try {
    const store = await loadWallets(config)
    wallets = {
      total: store.wallets.length,
      ready: store.wallets.filter((w) => w.fundedHbar && w.fundedUsdc && w.associatedUsdc).length,
      fundedHbar: store.wallets.filter((w) => w.fundedHbar).length,
      fundedUsdc: store.wallets.filter((w) => w.fundedUsdc).length,
      associatedUsdc: store.wallets.filter((w) => w.associatedUsdc).length,
    }
  } catch (error) {
    walletsError = error instanceof Error ? error.message : String(error)
  }

  let funders: Array<{
    index: number
    accountId: string
    hbar: number
    usdc: number
    associatedUsdc: boolean
  }> = []
  let fundersError: string | undefined
  try {
    const list = loadFunders(config)
    funders = await Promise.all(
      list.map(async (funder) => {
        const bal = await accountBalances(config, funder.accountId, config.USDC_TOKEN_ID)
        return {
          index: funder.index,
          accountId: funder.accountId,
          hbar: bal.hbar,
          usdc: bal.usdc,
          associatedUsdc: bal.associatedUsdc,
        }
      }),
    )
  } catch (error) {
    fundersError = error instanceof Error ? error.message : String(error)
  }

  let merchant: { ok: boolean; status?: number; error?: string; url: string } = {
    ok: false,
    url: `${config.X402_BASE_URL.replace(/\/$/, '')}/health`,
  }
  try {
    const response = await fetch(merchant.url, { signal: AbortSignal.timeout(8_000) })
    merchant = { ok: response.ok, status: response.status, url: merchant.url }
  } catch (error) {
    merchant = {
      ok: false,
      url: merchant.url,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  const routeOk = routes.filter((r) => r.ok > 0).length
  const routeFail = routes.filter((r) => r.fail > 0).length
  const ready = Boolean(wallets?.ready)
  const running = loop.running || isLoopRunning()
  const status =
    ready && merchant.ok && running
      ? 'ok'
      : ready && merchant.ok
        ? 'idle'
        : ready
          ? 'degraded'
          : 'starting'

  return {
    status,
    service: 'finality-x402-keeper',
    version: '1.0.0',
    ts: new Date().toISOString(),
    uptimeSeconds: process.uptime(),
    control: {
      tokenRequired: Boolean(config.KEEPER_CONTROL_TOKEN.trim()),
      loopAutostart: config.LOOP_AUTOSTART,
      endpointFilter: getEndpointFilter(),
      endpointFilterPresets: listEndpointFilterPresets(),
      delay: getDelayRange(),
      delayPresets: listDelayPresets(),
      lastError: getControllerError(),
    },
    merchant: {
      baseUrl: config.X402_BASE_URL,
      health: merchant,
      network: config.X402_NETWORK,
      usdcTokenId: config.USDC_TOKEN_ID,
      hbarAsset: config.HBAR_ASSET,
      facilitator: config.FACILITATOR,
      mirrorNode: config.MIRROR_NODE_URL,
    },
    loop: { ...loop, running },
    wallets: wallets ?? { error: walletsError },
    funders: fundersError ? { error: fundersError } : funders,
    routes: {
      catalog: catalog.map((e) => ({
        operationId: e.operationId,
        method: e.method,
        path: e.path,
        price: e.price,
      })),
      count: catalog.length,
      withSuccess: routeOk,
      withFailure: routeFail,
      stats: routes,
    },
    logs: {
      count: recentLogs.length,
      recent: recentLogs,
    },
    ui: '/',
  }
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim()
        if (!raw) return resolve({})
        resolve(JSON.parse(raw) as Record<string, unknown>)
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

export async function startHealthServer(config: KeeperConfig): Promise<Server> {
  // Seed runtime filter/delay from env once; UI can change them without editing .env.
  try {
    setEndpointFilter(config.ENDPOINT_FILTER)
  } catch {
    setEndpointFilter('onchain,pro')
  }
  seedDelayFromConfig(config.MIN_DELAY_MS, config.MAX_DELAY_MS)

  const port = config.HEALTH_PORT
  let uiHtml = ''
  try {
    uiHtml = await readFile(uiPath, 'utf8')
  } catch {
    uiHtml = '<!doctype html><title>Keeper</title><p>UI missing — GET /health</p>'
  }

  const server = createServer(async (req, res) => {
    const path = (req.url || '/').split('?')[0]
    try {
      if (req.method === 'OPTIONS') {
        cors(res)
        res.writeHead(204)
        res.end()
        return
      }

      if (req.method === 'GET' && (path === '/' || path === '/ui' || path === '/index.html')) {
        sendHtml(res, 200, uiHtml)
        return
      }
      // Liveness only — for Render / UptimeRobot / Docker. Never call merchant or mirror.
      if (req.method === 'GET' && (path === '/healthz' || path === '/ping')) {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('ok')
        return
      }
      if (req.method === 'GET' && path === '/health') {
        const body = await buildHealth(config, req)
        sendJson(res, body.status === 'starting' ? 503 : 200, body)
        return
      }
      if (req.method === 'GET' && path === '/routes') {
        const filter = getEndpointFilter()
        const catalog = activeEndpoints(filter)
        sendJson(res, 200, {
          baseUrl: config.X402_BASE_URL,
          filter,
          presets: listEndpointFilterPresets(),
          count: catalog.length,
          routes: catalog,
          stats: getRouteStats(),
        })
        return
      }
      if (req.method === 'GET' && path === '/logs') {
        sendJson(res, 200, { logs: getLogs(readLimit(req, 100)) })
        return
      }
      if (req.method === 'POST' && path === '/api/filter') {
        if (!requireControl(config, req, res)) return
        try {
          const body = await readJsonBody(req)
          const raw = String(body.filter ?? body.endpointFilter ?? '')
          const next = setEndpointFilter(raw)
          const catalog = activeEndpoints(next)
          initRouteStats(catalog)
          log('loop.control', { action: 'filter', filter: next, routes: catalog.length })
          pushLog({
            level: 'info',
            event: 'filter.set',
            message: `endpoint filter → ${next} (${catalog.length} routes)`,
            data: { filter: next, routes: catalog.length },
          })

          let restarted = false
          if (isLoopRunning()) {
            await stopLoop()
            const start = await startLoop(config)
            restarted = start.ok
            if (!start.ok) {
              sendJson(res, 409, {
                ok: false,
                filter: next,
                routes: catalog.length,
                error: start.error || 'filter set but loop failed to restart',
              })
              return
            }
          }

          sendJson(res, 200, {
            ok: true,
            filter: next,
            routes: catalog.length,
            restarted,
            presets: listEndpointFilterPresets(),
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sendJson(res, 400, { ok: false, error: message })
        }
        return
      }
      if (req.method === 'POST' && path === '/api/delay') {
        if (!requireControl(config, req, res)) return
        try {
          const body = await readJsonBody(req)
          const raw = String(body.delay ?? body.delayPreset ?? body.id ?? '')
          const next = setDelayPreset(raw)
          log('loop.control', { action: 'delay', delay: next.id, minDelayMs: next.minDelayMs, maxDelayMs: next.maxDelayMs })
          pushLog({
            level: 'info',
            event: 'delay.set',
            message: `delay → ${next.label} (${next.minDelayMs}–${next.maxDelayMs}ms)`,
            data: { id: next.id, minDelayMs: next.minDelayMs, maxDelayMs: next.maxDelayMs },
          })

          let restarted = false
          if (isLoopRunning()) {
            await stopLoop()
            const start = await startLoop(config)
            restarted = start.ok
            if (!start.ok) {
              sendJson(res, 409, {
                ok: false,
                delay: getDelayRange(),
                error: start.error || 'delay set but loop failed to restart',
              })
              return
            }
          }

          sendJson(res, 200, {
            ok: true,
            delay: getDelayRange(),
            restarted,
            presets: listDelayPresets(),
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sendJson(res, 400, { ok: false, error: message })
        }
        return
      }
      if (req.method === 'POST' && path === '/api/start') {
        if (!requireControl(config, req, res)) return
        try {
          const body = await readJsonBody(req)
          if (body.filter != null || body.endpointFilter != null) {
            const next = setEndpointFilter(String(body.filter ?? body.endpointFilter))
            initRouteStats(activeEndpoints(next))
          }
          if (body.delay != null || body.delayPreset != null) {
            setDelayPreset(String(body.delay ?? body.delayPreset))
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sendJson(res, 400, { ok: false, error: message })
          return
        }
        const result = await startLoop(config)
        sendJson(res, result.ok ? 200 : 409, {
          ...result,
          filter: getEndpointFilter(),
          delay: getDelayRange(),
        })
        return
      }
      if (req.method === 'POST' && path === '/api/stop') {
        if (!requireControl(config, req, res)) return
        const result = await stopLoop()
        sendJson(res, result.ok ? 200 : 409, result)
        return
      }

      sendJson(res, 404, {
        error: 'not_found',
        paths: [
          'GET /',
          'GET /healthz',
          'GET /ping',
          'GET /health',
          'GET /routes',
          'GET /logs?limit=50',
          'POST /api/filter',
          'POST /api/delay',
          'POST /api/start',
          'POST /api/stop',
        ],
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pushLog({ level: 'fail', message: `health handler error: ${message}` })
      sendJson(res, 500, { error: message })
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '0.0.0.0', () => resolve())
  })

  ok(`keeper UI listening on http://0.0.0.0:${port}/`)
  msg(`routes: GET /  GET /healthz  GET /health  GET /logs  POST /api/filter  POST /api/delay  POST /api/start  POST /api/stop`)
  log('health.listen', {
    port,
    paths: ['/', '/healthz', '/ping', '/health', '/routes', '/logs', '/api/filter', '/api/delay', '/api/start', '/api/stop'],
    endpointFilter: getEndpointFilter(),
    delay: getDelayRange(),
  })
  pushLog({
    level: 'ok',
    event: 'health.listen',
    message: `keeper UI on :${port}`,
    data: { port, endpointFilter: getEndpointFilter(), delay: getDelayRange() },
  })

  return server
}
