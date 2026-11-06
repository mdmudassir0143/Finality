import { z } from 'zod'
import { resolve } from 'node:path'

const baseSchema = z.object({
  /** Hedera network label used by the merchant / x402 client. */
  X402_NETWORK: z.enum(['hedera-testnet', 'hedera-mainnet']).default('hedera-testnet'),
  /** Circle USDC HTS token id (testnet default 0.0.429274). */
  USDC_TOKEN_ID: z.string().default('0.0.429274'),
  /** Native HBAR asset id for x402 exact scheme. */
  HBAR_ASSET: z.string().default('0.0.0'),
  USDC_DECIMALS: z.coerce.number().int().min(0).max(19).default(6),
  X402_BASE_URL: z.string().url().default('https://finality-x402-backend.onrender.com'),
  /** Blocky402 (or other) facilitator — informational; payment requirements come from merchant. */
  FACILITATOR: z.string().url().default('https://api.testnet.blocky402.com'),
  /** Mirror Node REST base (no trailing slash). Empty → derived from X402_NETWORK. */
  MIRROR_NODE_URL: z.string().default(''),
  HBAR_DRIP_AMOUNT: z.coerce.number().positive().default(5),
  USDC_DROP_AMOUNT: z.coerce.number().positive().default(5),
  /** Fleet size. Default 15 for lighter runs; set WALLET_COUNT=50 for the full fleet. */
  WALLET_COUNT: z.coerce.number().int().positive().default(15),
  /** Optional operator that can AccountCreateTransaction new keeper wallets / funders. */
  OPERATOR_ACCOUNT_ID: z.string().optional().default(''),
  OPERATOR_PRIVATE_KEY: z.string().optional().default(''),
  FUNDER_1_ACCOUNT_ID: z.string().optional().default(''),
  FUNDER_1_PRIVATE_KEY: z.string().optional().default(''),
  FUNDER_2_ACCOUNT_ID: z.string().optional().default(''),
  FUNDER_2_PRIVATE_KEY: z.string().optional().default(''),
  FUNDER_3_ACCOUNT_ID: z.string().optional().default(''),
  FUNDER_3_PRIVATE_KEY: z.string().optional().default(''),
  FUNDER_4_ACCOUNT_ID: z.string().optional().default(''),
  FUNDER_4_PRIVATE_KEY: z.string().optional().default(''),
  FUNDER_5_ACCOUNT_ID: z.string().optional().default(''),
  FUNDER_5_PRIVATE_KEY: z.string().optional().default(''),
  // Paid-loop jitter (ms). 30s–2 minute window for human-like cadence.
  MIN_DELAY_MS: z.coerce.number().int().nonnegative().default(30_000),
  MAX_DELAY_MS: z.coerce.number().int().nonnegative().default(120_000),
  MAX_CALLS: z.coerce.number().int().nonnegative().default(0),
  /** HTTP health/UI port (GET /, /healthz, /health, /logs, POST /api/start|stop). */
  HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(4090),
  /** Optional bearer token required for start/stop (recommended when public). */
  KEEPER_CONTROL_TOKEN: z.string().default(''),
  /** Auto-start the traffic loop when `npm run run` boots the UI server. */
  LOOP_AUTOSTART: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /**
   * Which paid routes the loop may hit.
   * - `onchain` — Hedera Mirror Node routes only
   * - `pro` — Intelligence + Agent + AI (Gemini-backed, $1–$4)
   * - `onchain,pro` — both (default)
   * - `all` — full catalog including market data
   * - comma list of operationId prefixes/ids
   */
  ENDPOINT_FILTER: z.string().default('onchain,pro'),
})

export type KeeperConfig = z.infer<typeof baseSchema> & {
  walletsPath: string
  dataDir: string
}

export function defaultMirrorForNetwork(network: KeeperConfig['X402_NETWORK']): string {
  return network === 'hedera-mainnet'
    ? 'https://mainnet-public.mirrornode.hedera.com'
    : 'https://testnet.mirrornode.hedera.com'
}

/** CAIP-2 network id for @x402/hedera ExactHederaScheme. */
export function hederaCaip2(network: KeeperConfig['X402_NETWORK']): 'hedera:testnet' | 'hedera:mainnet' {
  return network === 'hedera-mainnet' ? 'hedera:mainnet' : 'hedera:testnet'
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): KeeperConfig {
  const parsed = baseSchema.safeParse(env)
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid keeper env: ${missing}`)
  }
  if (parsed.data.MIN_DELAY_MS > parsed.data.MAX_DELAY_MS) {
    throw new Error('MIN_DELAY_MS must be <= MAX_DELAY_MS')
  }
  // Render (and most PaaS) inject PORT — prefer it over HEALTH_PORT.
  const platformPort = env.PORT ? Number(env.PORT) : NaN
  const healthPort =
    Number.isFinite(platformPort) && platformPort > 0 ? platformPort : parsed.data.HEALTH_PORT
  const dataDir = resolve(process.cwd(), 'data')
  const mirror =
    parsed.data.MIRROR_NODE_URL.trim() || defaultMirrorForNetwork(parsed.data.X402_NETWORK)
  return {
    ...parsed.data,
    MIRROR_NODE_URL: mirror.replace(/\/$/, ''),
    HEALTH_PORT: healthPort,
    dataDir,
    walletsPath: resolve(dataDir, 'wallets.json'),
  }
}

export function requireFunders(config: KeeperConfig): KeeperConfig {
  const pairs: Array<[string, string]> = [
    [config.FUNDER_1_ACCOUNT_ID, config.FUNDER_1_PRIVATE_KEY],
    [config.FUNDER_2_ACCOUNT_ID, config.FUNDER_2_PRIVATE_KEY],
    [config.FUNDER_3_ACCOUNT_ID, config.FUNDER_3_PRIVATE_KEY],
    [config.FUNDER_4_ACCOUNT_ID, config.FUNDER_4_PRIVATE_KEY],
    [config.FUNDER_5_ACCOUNT_ID, config.FUNDER_5_PRIVATE_KEY],
  ]
  const missing: string[] = []
  pairs.forEach(([accountId, privateKey], i) => {
    const n = i + 1
    if (!accountId?.trim()) missing.push(`FUNDER_${n}_ACCOUNT_ID`)
    if (!privateKey?.trim()) missing.push(`FUNDER_${n}_PRIVATE_KEY`)
  })
  if (missing.length) {
    throw new Error(`Missing funder credentials in .env: ${missing.join(', ')}`)
  }
  return config
}
