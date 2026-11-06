import { accountBalances } from './hedera.js'
import { loadConfig, requireFunders, type KeeperConfig } from './config.js'
import { createFunderWallets } from './create-funders.js'
import { fundWallets, associateAllFunders, associateAllWallets } from './fund.js'
import { banner, fail, log, msg, ok } from './util.js'
import { createWallets, loadFunders, loadWallets } from './wallets.js'

function parseArgs(argv: string[]) {
  const [command = 'help', ...rest] = argv
  return {
    command,
    force: rest.includes('--force'),
    noEnv: rest.includes('--no-env'),
  }
}

function help(): void {
  console.log(`
Finality x402 Keeper (Hedera)
─────────────────────────────
Create 5 funders + WALLET_COUNT wallets (default 15; set 50 for full fleet),
drip HBAR / associate USDC / drop USDC, then randomly hit paid x402 routes.

Commands:
  funders [--force]    Generate 5 funder keypairs → data/funders.json (+ patch .env)
                       With OPERATOR_* set, also AccountCreateTransaction on-chain
  funders-associate    Associate all 5 funders with USDC (TokenAssociateTransaction)
  wallets [--force]    Generate WALLET_COUNT Hedera ECDSA keys → data/wallets.json
  fund                 Create accounts (if needed) + HBAR drip + USDC associate + drop
  associate            Associate all funded keeper wallets with USDC
  run                  UI + health HTTP; auto-starts loop (LOOP_AUTOSTART=true)
  health               UI + health HTTP only (Start/Stop from browser)
  setup [--force]      funders (if missing) + wallets + fund
  status               Show funder + sample wallet balances (Mirror Node)
  help                 Show this message

Examples:
  npm run funders
  npm run funders-associate
  npm run wallets
  npm run fund
  npm run run
  npm run health
  npm run setup

Env: npm run funders writes FUNDER_1…5_ACCOUNT_ID + PRIVATE_KEY into .env
     HEALTH_PORT=4090 → http://127.0.0.1:4090/
     KEEPER_CONTROL_TOKEN=… optional bearer for Start/Stop
     LOOP_AUTOSTART=true|false
     X402_NETWORK=hedera-testnet  USDC_TOKEN_ID=0.0.429274
`)
}

async function status(config: KeeperConfig): Promise<void> {
  banner('Status')
  msg(`network=${config.X402_NETWORK}  mirror=${config.MIRROR_NODE_URL}`)
  msg(`usdc=${config.USDC_TOKEN_ID}  facilitator=${config.FACILITATOR}  x402=${config.X402_BASE_URL}`)
  const funders = loadFunders(config)

  msg('funders:')
  for (const funder of funders) {
    const bal = await accountBalances(config, funder.accountId, config.USDC_TOKEN_ID)
    ok(
      `funder #${funder.index}  ${funder.accountId}  HBAR=${bal.hbar}  USDC=${bal.usdc}  associated=${bal.associatedUsdc}`,
    )
    log('status.funder', { index: funder.index, accountId: funder.accountId, ...bal })
  }

  try {
    const store = await loadWallets(config)
    msg(`wallets file: ${config.walletsPath} (${store.wallets.length} accounts)`)
    const sampleIdx = new Set(
      [0, 1, 2, Math.floor(store.wallets.length / 2), store.wallets.length - 1].filter(
        (i) => i >= 0 && i < store.wallets.length,
      ),
    )
    msg('sample wallets:')
    for (const i of sampleIdx) {
      const wallet = store.wallets[i]!
      if (!wallet.accountId) {
        ok(`#${wallet.index}  (no accountId yet)  fundedHbar=${wallet.fundedHbar ?? false}`)
        continue
      }
      const bal = await accountBalances(config, wallet.accountId, config.USDC_TOKEN_ID)
      ok(
        `#${wallet.index}  ${wallet.accountId}  HBAR=${bal.hbar}  USDC=${bal.usdc}  fundedHbar=${wallet.fundedHbar ?? false}  associated=${wallet.associatedUsdc ?? false}  fundedUsdc=${wallet.fundedUsdc ?? false}`,
      )
      log('status.wallet', {
        index: wallet.index,
        accountId: wallet.accountId,
        fundedHbar: wallet.fundedHbar ?? false,
        fundedUsdc: wallet.fundedUsdc ?? false,
        ...bal,
      })
    }
    const summary = {
      wallets: store.wallets.length,
      fundedHbar: store.wallets.filter((w) => w.fundedHbar).length,
      fundedUsdc: store.wallets.filter((w) => w.fundedUsdc).length,
      associatedUsdc: store.wallets.filter((w) => w.associatedUsdc).length,
    }
    ok(
      `summary  fundedHbar=${summary.fundedHbar}  associated=${summary.associatedUsdc}  fundedUsdc=${summary.fundedUsdc} / ${summary.wallets}`,
    )
    log('status.summary', summary)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
    log('status.wallets', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function main(): Promise<void> {
  // Load .env when present (local); cloud hosts inject env vars directly.
  try {
    const { config: dotenvConfig } = await import('dotenv')
    const { resolve } = await import('node:path')
    dotenvConfig({ path: resolve(process.cwd(), '.env') })
  } catch {
    /* optional */
  }

  const { command, force, noEnv } = parseArgs(process.argv.slice(2))

  if (command === 'help' || command === '--help' || command === '-h') {
    help()
    return
  }

  msg(`command=${command}${force ? ' --force' : ''}${noEnv ? ' --no-env' : ''}`)

  if (command === 'funders') {
    await createFunderWallets(force, !noEnv)
    return
  }

  const config = loadConfig()
  const { ensureWalletsSeeded } = await import('./seed.js')
  await ensureWalletsSeeded(config)

  switch (command) {
    case 'funders-associate':
      await associateAllFunders(requireFunders(config))
      break
    case 'wallets':
      await createWallets(config, force)
      break
    case 'fund':
      await fundWallets(requireFunders(config))
      break
    case 'associate':
      await associateAllWallets(requireFunders(config))
      break
    case 'run': {
      const {
        initRouteStats,
        setLoopSnapshot,
        setEndpointFilter,
        getEndpointFilter,
        seedDelayFromConfig,
        getDelayRange,
      } = await import('./state.js')
      const { startHealthServer } = await import('./health.js')
      const { startLoop } = await import('./controller.js')
      const { activeEndpoints } = await import('./endpoints.js')
      try {
        setEndpointFilter(config.ENDPOINT_FILTER)
      } catch {
        setEndpointFilter('onchain,pro')
      }
      seedDelayFromConfig(config.MIN_DELAY_MS, config.MAX_DELAY_MS)
      initRouteStats(activeEndpoints(getEndpointFilter()))
      let ready = 0
      let total = 0
      try {
        const store = await loadWallets(config)
        total = store.wallets.length
        ready = store.wallets.filter((w) => w.fundedHbar && w.fundedUsdc && w.associatedUsdc).length
      } catch {
        /* wallets optional until start */
      }
      const delay = getDelayRange()
      setLoopSnapshot({
        running: false,
        readyWallets: ready,
        totalWallets: total,
        baseUrl: config.X402_BASE_URL,
        minDelayMs: delay.minDelayMs,
        maxDelayMs: delay.maxDelayMs,
        maxCalls: config.MAX_CALLS || 'forever',
      })
      await startHealthServer(config)
      msg(
        `UI http://127.0.0.1:${config.HEALTH_PORT}/  filter=${getEndpointFilter()}  delay=${delay.label} (change in UI dropdowns)`,
      )
      if (config.LOOP_AUTOSTART) {
        const started = await startLoop(config)
        if (!started.ok) fail(`autostart failed: ${started.error}`)
      } else {
        msg('LOOP_AUTOSTART=false — use UI Start or POST /api/start')
      }
      await new Promise(() => {})
      break
    }
    case 'health': {
      const {
        initRouteStats,
        setLoopSnapshot,
        setEndpointFilter,
        getEndpointFilter,
        seedDelayFromConfig,
        getDelayRange,
      } = await import('./state.js')
      const { startHealthServer } = await import('./health.js')
      const { activeEndpoints } = await import('./endpoints.js')
      try {
        setEndpointFilter(config.ENDPOINT_FILTER)
      } catch {
        setEndpointFilter('onchain,pro')
      }
      seedDelayFromConfig(config.MIN_DELAY_MS, config.MAX_DELAY_MS)
      initRouteStats(activeEndpoints(getEndpointFilter()))
      let ready = 0
      let total = 0
      try {
        const store = await loadWallets(config)
        total = store.wallets.length
        ready = store.wallets.filter((w) => w.fundedHbar && w.fundedUsdc && w.associatedUsdc).length
      } catch {
        /* wallets optional for health-only mode */
      }
      const delay = getDelayRange()
      setLoopSnapshot({
        running: false,
        readyWallets: ready,
        totalWallets: total,
        baseUrl: config.X402_BASE_URL,
        minDelayMs: delay.minDelayMs,
        maxDelayMs: delay.maxDelayMs,
        maxCalls: config.MAX_CALLS || 'forever',
      })
      await startHealthServer(config)
      msg(
        `UI http://127.0.0.1:${config.HEALTH_PORT}/  (idle — Start from UI)  filter=${getEndpointFilter()}  delay=${delay.label}`,
      )
      await new Promise(() => {})
      break
    }
    case 'setup': {
      msg('setup = funders (if needed) + wallets + fund')
      const { existsSync } = await import('node:fs')
      const { resolve } = await import('node:path')
      const fundersFile = resolve(process.cwd(), 'data/funders.json')
      if (!existsSync(fundersFile) || force) {
        await createFunderWallets(force, true)
      } else {
        msg(`funders already exist at ${fundersFile} (skip; use --force to regenerate)`)
      }
      // reload env after funders patch
      const { config: dotenvConfig } = await import('dotenv')
      dotenvConfig({ path: resolve(process.cwd(), '.env'), override: true })
      const refreshed = requireFunders(loadConfig())
      await createWallets(refreshed, force)
      await fundWallets(refreshed)
      ok('setup finished — next: npm run run')
      break
    }
    case 'status':
      await status(requireFunders(config))
      break
    default:
      help()
      throw new Error(`Unknown command: ${command}`)
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
