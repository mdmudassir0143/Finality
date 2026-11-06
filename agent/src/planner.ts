/**
 * Goal → plan. Scores each catalog operation by keyword overlap with the goal (operation id, description),
 * expanded with a small synonym table, then keeps the most relevant operations that fit the budget, cheapest
 * first on ties. Deterministic on purpose: the same goal and catalog always produce the same, explainable plan.
 */
export type CatalogEntry = {
  operationId: string
  method: 'GET' | 'POST'
  path: string
  price: string
  description: string
  requestExample?: Record<string, unknown>
}

export type PlannedCall = CatalogEntry & { usd: number; score: number; matched: string[]; input: Record<string, unknown> }

const STOP = new Set(['the', 'and', 'for', 'with', 'brief', 'report', 'get', 'give', 'about', 'what'])

const SYNONYMS: Record<string, string[]> = {
  network: ['supply', 'nodes', 'blocks'],
  health: ['nodes', 'blocks', 'supply'],
  market: ['quotes', 'trending', 'fear', 'greed'],
  sentiment: ['fear', 'greed', 'trending'],
  price: ['quotes', 'prices', 'candles'],
  prices: ['quotes', 'prices', 'candles'],
  token: ['token', 'tokens'],
  account: ['account', 'balances'],
  wallet: ['account', 'balances'],
  hbar: ['supply', 'quotes'],
}

export function usdFromPrice(price: string): number {
  return Number(String(price).replace(/[^0-9.]/g, '')) || 0
}

function tokenize(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
}

/** Uppercase tickers in the goal (e.g. "HBAR market brief" → ["HBAR"]). */
export function tickersIn(goal: string): string[] {
  const ignore = new Set(['USD', 'API', 'HCS', 'EVM', 'AND', 'THE'])
  return [...new Set((goal.match(/\b[A-Z]{2,6}\b/g) ?? []).filter((t) => !ignore.has(t)))]
}

export function planCalls(
  goal: string,
  catalog: CatalogEntry[],
  opts: { budgetUsd: number; maxCalls?: number; only?: string[] },
): PlannedCall[] {
  const words = tokenize(goal)
  const terms = new Set(words.flatMap((w) => [w, ...(SYNONYMS[w] ?? [])]))
  const tickers = tickersIn(goal)

  const scored = catalog
    .filter((e) => (opts.only?.length ? opts.only.includes(e.operationId) : true))
    .map((entry) => {
      const hay = new Set(tokenize(`${entry.operationId} ${entry.description}`))
      const matched = [...terms].filter((t) => hay.has(t))
      const input = { ...(entry.requestExample ?? {}) }
      if (tickers.length && Array.isArray(input.symbols)) input.symbols = tickers.slice(0, 10)
      return { ...entry, usd: usdFromPrice(entry.price), score: opts.only?.length ? 1 : matched.length, matched, input }
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || a.usd - b.usd || a.operationId.localeCompare(b.operationId))

  const plan: PlannedCall[] = []
  // Integer micro-USD so the budget fit is exact (no float drift across many small prices).
  const micros = (usd: number) => Math.round(usd * 1_000_000)
  const budget = micros(opts.budgetUsd)
  let total = 0
  for (const call of scored) {
    if (plan.length >= (opts.maxCalls ?? 5)) break
    if (total + micros(call.usd) > budget) continue
    plan.push(call)
    total += micros(call.usd)
  }
  return plan
}
