import { mkdir, writeFile, chmod } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { KeeperConfig } from './config.js'
import { msg, ok, warn } from './util.js'

/**
 * On Render (ephemeral disk), seed data/wallets.json from KEEPER_WALLETS_JSON.
 * Accepts raw JSON or base64-encoded JSON.
 */
export async function ensureWalletsSeeded(config: KeeperConfig): Promise<void> {
  if (existsSync(config.walletsPath)) {
    msg(`wallets present at ${config.walletsPath}`)
    return
  }

  const raw = (process.env.KEEPER_WALLETS_JSON || '').trim()
  if (!raw) {
    warn(
      `No ${config.walletsPath} and KEEPER_WALLETS_JSON unset — Start will fail until wallets are seeded`,
    )
    return
  }

  let jsonText = raw
  if (!raw.startsWith('{')) {
    try {
      jsonText = Buffer.from(raw, 'base64').toString('utf8')
    } catch {
      throw new Error('KEEPER_WALLETS_JSON is not valid JSON or base64 JSON')
    }
  }

  const parsed = JSON.parse(jsonText) as { wallets?: unknown[] }
  if (!Array.isArray(parsed.wallets) || !parsed.wallets.length) {
    throw new Error('KEEPER_WALLETS_JSON must contain a wallets[] array')
  }

  await mkdir(config.dataDir, { recursive: true })
  await writeFile(config.walletsPath, JSON.stringify(parsed, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  })
  await chmod(config.walletsPath, 0o600)
  ok(`seeded ${parsed.wallets.length} wallets from KEEPER_WALLETS_JSON → ${config.walletsPath}`)
}
