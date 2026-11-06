/**
 * Pack data/wallets.json into a base64 blob for Render env KEEPER_WALLETS_JSON.
 * Writes keeper/data/render-wallets.b64 (gitignored) — does not print secrets.
 *
 *   cd keeper && npx tsx scripts/pack-wallets-for-render.ts
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

async function main() {
  const src = resolve(process.cwd(), 'data/wallets.json')
  const out = resolve(process.cwd(), 'data/render-wallets.b64')
  const raw = await readFile(src)
  const b64 = raw.toString('base64')
  await writeFile(out, b64, { encoding: 'utf8', mode: 0o600 })
  console.log(
    JSON.stringify({
      wrote: out,
      bytes: b64.length,
      wallets: JSON.parse(raw.toString('utf8')).wallets?.length ?? 0,
      hint: 'Paste file contents into Render env KEEPER_WALLETS_JSON (secret)',
    }),
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
