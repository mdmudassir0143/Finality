import OpenAI from 'openai'
import { FinalityError } from '../../lib/contracts/errors'
import type { ProviderResult, Quote, Candle } from '../../lib/providers/types'
import {
  fetchMarketCandles,
  fetchMarketCategories,
  fetchMarketQuotes,
  fetchMarketTokenPrices,
  fetchMarketTrending,
} from '../../lib/providers/market'
import { mockCandles, mockMeta, mockQuotes } from '../../lib/providers/mock'
import { fetchHederaOperation } from '../../lib/onchain/hedera/mirror'
import type { Env } from '../config/env'

type AnyObject = Record<string, any>
type FallbackReason = 'missing_credentials' | 'invalid_credentials' | 'quota_exhausted' | 'rate_limited' | 'timeout' | 'upstream_error' | 'model_unavailable'

function fallbackReason(error: unknown): FallbackReason {
  const status = typeof error === 'object' && error ? Number((error as {status?:unknown}).status) : 0
  if (status === 401 || status === 403) return 'invalid_credentials'
  if (status === 429) return 'rate_limited'
  if (error instanceof FinalityError) {
    if (error.code.includes('quota')) return 'quota_exhausted'
    if (error.code.includes('rate')) return 'rate_limited'
    if (error.code.includes('credential')) return error.code.includes('invalid') ? 'invalid_credentials' : 'missing_credentials'
    if (error.code.includes('timeout')) return 'timeout'
  }
  return 'upstream_error'
}

/** Market / intelligence / agent / AI never surface upstream failures — always return dummy data. */
function isSoftDomain(operationId: string) {
  return /^(market|intelligence|agent|ai)\./.test(operationId)
}

function canFallback(env: Env, soft: boolean) {
  if (soft) return true
  return env.DATA_MODE === 'auto' && env.ALLOW_MOCK_FALLBACK
}

async function provider<T>(
  env: Env,
  live: () => Promise<ProviderResult<T>>,
  mock: (reason?: FallbackReason) => ProviderResult<T>,
  soft = false,
): Promise<ProviderResult<T>> {
  if (env.DATA_MODE === 'mock') return mock()
  try { return await live() }
  catch (error) {
    if (canFallback(env, soft)) return mock(fallbackReason(error))
    throw error
  }
}

function sma(values: number[], period: number) { return values.slice(-period).reduce((a,b) => a+b, 0) / Math.min(period, values.length) }
function rsi(values: number[], period = 14) {
  const changes = values.slice(-period - 1).slice(1).map((v,i) => v - values.slice(-period - 1)[i])
  const gains = changes.reduce((a,v) => a + Math.max(v,0),0) / period
  const losses = changes.reduce((a,v) => a + Math.max(-v,0),0) / period
  return losses === 0 ? 100 : 100 - 100 / (1 + gains/losses)
}
function technical(candles: Candle[]) {
  const closes = candles.map(c => c.close), last = closes.at(-1) ?? 0
  const fast = sma(closes, 10), slow = sma(closes, 30), rsi14 = rsi(closes)
  const direction = fast > slow * 1.002 ? 'BUY' : fast < slow * .998 ? 'SELL' : 'HOLD'
  const score = Math.max(0, Math.min(100, 50 + (fast/slow-1)*800 + (50-rsi14)*.25))
  return { price: last, sma10: fast, sma30: slow, rsi14, momentum: closes.length > 1 ? (last/closes[0]-1)*100 : 0, regime: fast > slow ? 'trending_up' : fast < slow ? 'trending_down' : 'ranging', direction, score }
}

async function candlesFor(env: Env, input: AnyObject) {
  const symbol = input.symbols?.[0] ?? 'BTC', limit = input.limit ?? 100
  return provider(
    env,
    () => fetchMarketCandles(symbol, input.interval ?? '1h', limit, marketOpts(env)),
    reason => mockCandles(symbol, limit, reason),
    true,
  )
}

async function json(url: string) {
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) })
    if (!response.ok) throw new Error(String(response.status))
    return response.json()
  } catch { throw new FinalityError('provider_unavailable', 'Upstream provider unavailable', 503, true) }
}

const liveMeta = (source: string, freshnessSeconds: number, limitations: string[] = []) => ({ source, provider: 'public-rest', asOf: new Date().toISOString(), freshnessSeconds, limitations, availabilityTrack: 'durable' as const, dataMode: 'live' as const, synthetic: false })

function marketOpts(env: Env) {
  return { coingeckoApiKey: env.COINGECKO_API_KEY, coingeckoProApiKey: env.COINGECKO_PRO_API_KEY }
}

async function quotes(env: Env, symbols: string[]) {
  return provider(
    env,
    () => fetchMarketQuotes(symbols, marketOpts(env)),
    reason => mockQuotes(symbols, reason),
    true,
  )
}

async function onchain(env: Env, operationId: string, input: AnyObject): Promise<ProviderResult<unknown>> {
  const data = await fetchHederaOperation(
    { MIRROR_NODE_URL: env.MIRROR_NODE_URL },
    operationId,
    input,
  )
  return {
    data,
    meta: liveMeta('hedera-mirror', 30, ['Mirror Node REST only; no invented pool or liquidity values']),
  }
}

const PRO_OPERATIONS = new Set([
  'intelligence.signals',
  'intelligence.technicals',
  'intelligence.report',
  'intelligence.volume',
  'intelligence.events',
  'intelligence.backtest',
  'agent.decision',
  'agent.briefing',
  'agent.strategyParse',
  'ai.chat',
])

const SYSTEM_PROMPT =
  'You are Finality Market Intelligence. Be concise, data-grounded, and state limitations. Never invent prices or events not present in the provided context. Not investment advice.'

/** Hard cap for Gemini/Groq/Ollama so paid x402 requests always finish with a 200 + receipt. */
const LLM_CALL_TIMEOUT_MS = 8_000
/** Overall budget for trying LLM backends before returning a deterministic mock answer. */
const LLM_TOTAL_BUDGET_MS = 8_000

type LlmBackend = 'gemini' | 'groq' | 'ollama'

function syntheticChat(prompt: unknown, reason: FallbackReason = 'model_unavailable'): ProviderResult<unknown> {
  return {
    data: {
      answer: `Synthetic analyst response for: ${String(prompt ?? '')}. Live model data is temporarily unavailable; this is a deterministic fallback for demo continuity.`,
      generatedByModel: false,
    },
    meta: mockMeta(reason),
  }
}

function openAiClient(env: Env, backend: LlmBackend): OpenAI {
  if (backend === 'gemini') {
    return new OpenAI({
      apiKey: env.GEMINI_API_KEY,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      timeout: LLM_CALL_TIMEOUT_MS,
    })
  }
  if (backend === 'groq') {
    return new OpenAI({
      apiKey: env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
      timeout: LLM_CALL_TIMEOUT_MS,
    })
  }
  return new OpenAI({
    apiKey: env.OLLAMA_API_KEY || 'ollama',
    baseURL: `${env.OLLAMA_BASE_URL.replace(/\/$/, '')}/v1`,
    timeout: LLM_CALL_TIMEOUT_MS,
  })
}

function modelFor(env: Env, backend: LlmBackend): string {
  if (backend === 'gemini') return env.GEMINI_MODEL || 'gemini-2.0-flash'
  if (backend === 'groq') return env.GROQ_MODEL
  return env.OLLAMA_MODEL
}

function backendReady(env: Env, backend: LlmBackend): boolean {
  if (backend === 'gemini') return Boolean(env.GEMINI_API_KEY)
  if (backend === 'groq') return Boolean(env.GROQ_API_KEY && env.GROQ_MODEL)
  return Boolean(env.OLLAMA_BASE_URL)
}

/** Prefer Gemini for pro routes; then configured provider; then Ollama. */
function proBackendOrder(env: Env): LlmBackend[] {
  const ordered: LlmBackend[] = []
  const push = (b: LlmBackend) => {
    if (!ordered.includes(b) && backendReady(env, b)) ordered.push(b)
  }
  push('gemini')
  if (env.LLM_PROVIDER === 'groq') push('groq')
  if (env.LLM_PROVIDER === 'ollama') push('ollama')
  if (env.LLM_PROVIDER === 'gemini') push('gemini')
  push('groq')
  push('ollama')
  return ordered
}

function withTimeout<T>(promise: Promise<T>, ms: number, label = 'llm_timeout'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error(label), { status: 408 })), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function completeText(
  env: Env,
  user: string,
  system = SYSTEM_PROMPT,
  maxTokens = 500,
): Promise<{ text: string; source: LlmBackend } | null> {
  if (env.DATA_MODE === 'mock') return null
  const backends = proBackendOrder(env)
  if (!backends.length) return null

  const started = Date.now()
  for (const backend of backends) {
    const remaining = LLM_TOTAL_BUDGET_MS - (Date.now() - started)
    if (remaining < 1_500) break
    try {
      const client = openAiClient(env, backend)
      const result = await withTimeout(
        client.chat.completions.create({
          model: modelFor(env, backend),
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        Math.min(LLM_CALL_TIMEOUT_MS, remaining),
      )
      const text = result.choices[0]?.message?.content?.trim() ?? ''
      if (!text) throw new Error('empty_model_response')
      return { text, source: backend }
    } catch {
      /* try next backend or fall through to deterministic mock */
    }
  }
  return null
}

function modelMeta(source: LlmBackend, base?: ProviderResult<unknown>['meta'], fallbackReason?: FallbackReason): ProviderResult<unknown>['meta'] {
  const quota = source === 'ollama' ? ('durable' as const) : ('quota-limited' as const)
  const live = liveMeta(source, 0, [])
  // A narrative written over synthetic (fallback) market data is still synthetic: keep the upstream labels so
  // buyers can tell real analysis from analysis of fixture numbers.
  if (base?.synthetic) return { ...syntheticMeta(base), source, availabilityTrack: quota }
  return {
    ...live,
    asOf: base?.asOf ?? live.asOf,
    freshnessSeconds: base?.freshnessSeconds ?? 0,
    source,
    availabilityTrack: quota,
    synthetic: false,
    dataMode: 'live' as const,
    ...(fallbackReason ? { fallback: true as const, fallbackReason } : {}),
  }
}

/** Meta for a deterministic (non-LLM) answer: live only if the data under it is live. */
function deterministicMeta(base?: ProviderResult<unknown>['meta']): ProviderResult<unknown>['meta'] {
  if (base?.synthetic) return syntheticMeta(base)
  return { ...liveMeta('finality-deterministic', 0), synthetic: false, dataMode: 'live' as const }
}

/** Synthetic/fallback labels; never present fixture or canned output as live data. */
function syntheticMeta(base?: ProviderResult<unknown>['meta'], reason?: FallbackReason): ProviderResult<unknown>['meta'] {
  const mock = mockMeta(reason ?? base?.fallbackReason ?? 'upstream_error')
  return {
    ...mock,
    source: 'finality-deterministic',
    limitations: [...new Set([...(base?.limitations ?? []), ...mock.limitations])],
  }
}

async function llm(env: Env, input: AnyObject): Promise<ProviderResult<unknown>> {
  const symbols = Array.isArray(input.symbols) ? input.symbols.join(', ') : ''
  const prompt = `Symbols: ${symbols || 'n/a'}\nUser question: ${String(input.prompt ?? '')}`
  const result = await completeText(env, prompt)
  if (!result) {
    const fallback = syntheticChat(input.prompt, 'model_unavailable')
    return {
      data: { ...(fallback.data as AnyObject), generatedByModel: false },
      meta: syntheticMeta(undefined, 'model_unavailable'),
    }
  }
  return {
    data: { answer: result.text, generatedByModel: true },
    meta: modelMeta(result.source),
  }
}

function deterministicProAnswer(operationId: string, data: AnyObject): string {
  switch (operationId) {
    case 'intelligence.volume':
      return `Volume for ${data.symbol ?? 'the symbol'} is ${Number(data.current ?? 0).toFixed(0)} vs average ${Number(data.average ?? 0).toFixed(0)} (ratio ${Number(data.ratio ?? 0).toFixed(2)})${data.spike ? '; flagged as a spike.' : '; within a normal range.'}`
    case 'intelligence.signals':
      return `Signal bias is ${(data.summary as AnyObject)?.direction ?? 'HOLD'} with average score ${Number((data.summary as AnyObject)?.averageScore ?? 0).toFixed(1)}.`
    case 'intelligence.technicals':
      return `Technicals show ${data.direction ?? 'HOLD'} in a ${String(data.regime ?? 'ranging').replace(/_/g, ' ')} regime (RSI ${Number(data.rsi14 ?? 0).toFixed(1)}).`
    case 'intelligence.report':
      return `Report signal ${data.signal ?? 'HOLD'} with risk ${data.risk ?? 'normal'}.`
    case 'intelligence.events':
      return `Detected ${Array.isArray(data.events) ? data.events.length : 0} price events from OHLCV thresholds.`
    case 'intelligence.backtest':
      return `Backtest return ${Number(data.returnPct ?? 0).toFixed(2)}% over ${data.trades ?? 0} trades (fees/slippage excluded).`
    case 'agent.decision':
      return String(data.rationale ?? `Action ${data.action ?? 'HOLD'} under ${data.risk ?? 'balanced'} risk.`)
    case 'agent.briefing':
      return `Briefing for ${data.symbol ?? 'market'}: bias ${data.bias ?? 'HOLD'}, regime ${String(data.regime ?? 'ranging').replace(/_/g, ' ')}, score ${Number(data.score ?? 0).toFixed(1)}.`
    case 'agent.strategyParse':
      return `Parsed strategy ${data.name ?? 'strategy'} (${data.validated ? 'validated' : 'needs review'}).`
    case 'ai.chat':
      return String(data.answer ?? 'Analysis unavailable; try again shortly.')
    default:
      return 'Analysis complete.'
  }
}

/** Attach a Gemini (or fallback LLM) narrative onto deterministic pro-endpoint payloads. */
async function withProModel(
  env: Env,
  operationId: string,
  base: ProviderResult<unknown>,
  task: string,
): Promise<ProviderResult<unknown>> {
  if (!PRO_OPERATIONS.has(operationId)) return base
  const grounded = JSON.stringify(base.data).slice(0, 6_000)
  const result = await completeText(
    env,
    `${task}\n\nGrounding JSON (do not contradict numbers):\n${grounded}`,
    SYSTEM_PROMPT,
    450,
  )
  const data = { ...(base.data as AnyObject) }
  if (!result) {
    const answer = deterministicProAnswer(operationId, data)
    if (operationId === 'agent.decision') data.rationale = answer
    return {
      data: { ...data, answer, generatedByModel: false },
      meta: deterministicMeta(base.meta),
    }
  }
  if (operationId === 'agent.decision') {
    data.rationale = result.text
  }
  data.answer = result.text
  data.generatedByModel = true
  return {
    data,
    meta: modelMeta(result.source, base.meta),
  }
}

function parseStrategyDeterministic(promptRaw: string) {
  const prompt = promptRaw.toLowerCase()
  const fast = Number(prompt.match(/(?:fast|short)[^0-9]*(\d+)/)?.[1] ?? 10)
  const slow = Number(prompt.match(/(?:slow|long)[^0-9]*(\d+)/)?.[1] ?? 30)
  return {
    name: 'Parsed moving-average strategy',
    rules: [
      { indicator: 'sma', operator: 'crosses_above', fastPeriod: fast, slowPeriod: slow, action: 'BUY' },
      { indicator: 'sma', operator: 'crosses_below', fastPeriod: fast, slowPeriod: slow, action: 'SELL' },
    ],
    validated: fast < slow,
  }
}

async function strategyParseWithModel(env: Env, promptRaw: string): Promise<ProviderResult<unknown>> {
  const fallback = parseStrategyDeterministic(promptRaw)
  const result = await completeText(
    env,
    `Parse this trading strategy into JSON only (no markdown). Schema: {"name":string,"rules":[{"indicator":"sma","operator":"crosses_above"|"crosses_below","fastPeriod":number,"slowPeriod":number,"action":"BUY"|"SELL"}],"validated":boolean,"answer":string}\nStrategy: ${promptRaw}`,
    SYSTEM_PROMPT,
    600,
  )
  if (!result) {
    return {
      data: { ...fallback, answer: `Deterministic parse of: ${promptRaw}`, generatedByModel: false },
      meta: { ...liveMeta('finality-deterministic', 0), synthetic: false, dataMode: 'live' as const },
    }
  }
  try {
    const cleaned = result.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(cleaned) as AnyObject
    const rules = Array.isArray(parsed.rules) ? parsed.rules : fallback.rules
    const data = {
      name: typeof parsed.name === 'string' ? parsed.name : fallback.name,
      rules,
      validated: typeof parsed.validated === 'boolean' ? parsed.validated : fallback.validated,
      answer: typeof parsed.answer === 'string' ? parsed.answer : result.text,
      generatedByModel: true,
    }
    return { data, meta: modelMeta(result.source) }
  } catch {
    return {
      data: { ...fallback, answer: result.text, generatedByModel: true },
      meta: modelMeta(result.source),
    }
  }
}

export async function executeOperation(env: Env, operationId: string, input: AnyObject): Promise<ProviderResult<unknown>> {
  try {
    return await executeOperationInner(env, operationId, input)
  } catch (error) {
    // Market / intelligence / agent / AI: never fail closed — return deterministic dummy data.
    if (!isSoftDomain(operationId)) throw error
    if (operationId === 'ai.chat') {
      const fallback = syntheticChat(input.prompt, fallbackReason(error))
      return { data: fallback.data, meta: syntheticMeta(undefined, fallbackReason(error)) }
    }
    const mockEnv = { ...env, DATA_MODE: 'mock' as const }
    const result = await executeOperationInner(mockEnv, operationId, input)
    // Pro routes still answer (200 + receipt), but the data came from fixtures, so it is labelled synthetic.
    if (PRO_OPERATIONS.has(operationId)) {
      const data = { ...(result.data as AnyObject) }
      if (typeof data.answer !== 'string') {
        data.answer = deterministicProAnswer(operationId, data)
      }
      return { data, meta: syntheticMeta(result.meta, fallbackReason(error)) }
    }
    return { ...result, meta: { ...result.meta, ...mockMeta(fallbackReason(error)) } }
  }
}

async function executeOperationInner(env: Env, operationId: string, input: AnyObject): Promise<ProviderResult<unknown>> {
  if (operationId.startsWith('onchain.')) {
    if (env.DATA_MODE === 'mock') return { data: { operationId, fixture: true, input }, meta: mockMeta() }
    return provider(env, () => onchain(env, operationId, input), reason => ({ data:{operationId,fixture:true,input},meta:mockMeta(reason) }))
  }
  if (operationId === 'ai.chat') return llm(env, input)
  if (operationId === 'market.quotes') return quotes(env, input.symbols)
  if (operationId === 'market.candles') return candlesFor(env, input)
  if (operationId === 'market.assets') {
    const q = String(input.query).toUpperCase()
    const known = ['BTC','ETH','BNB','SOL','XRP','DOGE','ADA','AVAX','LINK','DOT'].filter(s => s.includes(q)).slice(0,input.limit)
    const result = await quotes(env, known.length ? known : [q])
    return {
      data: result.data.map(v => ({
        symbol: v.symbol,
        name: v.name ?? v.symbol,
        marketType: 'crypto',
        quoteAsset: 'USD',
        marketCap: v.marketCap,
        change1h: v.change1h,
        change24h: v.change24h,
        change7d: v.change7d,
        change30d: v.change30d,
        sparkline: v.sparkline,
      })),
      meta: result.meta,
    }
  }
  if (operationId === 'market.trending') {
    const limit = input.limit ?? 10
    return provider(env, async () => {
      const result = await fetchMarketTrending(limit, marketOpts(env))
      return {
        data: result.data.map((v, i) => ({
          rank: v.rank ?? i + 1,
          symbol: v.symbol,
          name: v.name,
          price: v.price,
          change1h: v.change1h,
          change24h: v.change24h,
          change7d: v.change7d,
          change30d: v.change30d,
          volume24h: v.volume24h,
          marketCap: v.marketCap,
          sparkline: v.sparkline,
        })),
        meta: result.meta,
      }
    }, reason => {
      const mock = mockQuotes(['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT'].slice(0, limit), reason)
      return { data: mock.data.map((v, i) => ({ rank: i + 1, ...v })), meta: mock.meta }
    }, true)
  }
  if (operationId === 'market.categories') {
    return provider(env, () => fetchMarketCategories(marketOpts(env)), reason => ({
      data: [
        { id: 'layer-1', name: 'Layer 1', marketCapChange24h: 1.2, volume24h: 1e9 },
        { id: 'defi', name: 'DeFi', marketCapChange24h: -0.4, volume24h: 5e8 },
      ],
      meta: mockMeta(reason),
    }), true)
  }
  if (operationId === 'market.tokenPrices') {
    const network = String(input.network ?? 'eth')
    const addresses = (input.addresses as string[]).map(a => String(a))
    return provider(env, () => fetchMarketTokenPrices(network, addresses, marketOpts(env)), reason => ({
      data: addresses.map(address => ({
        network,
        address: address.toLowerCase(),
        priceUsd: 1,
        change24h: 0,
      })),
      meta: mockMeta(reason),
    }), true)
  }
  if (operationId === 'market.fearGreed') {
    if (env.DATA_MODE === 'mock') return { data: [{ value: 47, classification: 'Neutral', timestamp: '1767225600' }], meta: mockMeta() }
    return provider(env, async() => {
      const result: any = await json(`https://api.alternative.me/fng/?limit=${input.limit}`)
      return { data: result.data, meta: liveMeta('alternative.me', 86400, ['Alternative.me attribution required; not investment advice']) }
    }, reason => ({data:[{value:47,classification:'Neutral',timestamp:'1767225600'}],meta:mockMeta(reason)}), true)
  }

  if (operationId === 'agent.strategyParse') {
    return strategyParseWithModel(env, String(input.prompt))
  }

  const result = await candlesFor(env, input), tech = technical(result.data)
  if (operationId === 'intelligence.technicals') {
    return withProModel(env, operationId, { data: tech, meta: result.meta }, 'Explain these technical indicators and market regime in 3-5 short sentences.')
  }
  if (operationId === 'intelligence.signals') {
    return withProModel(
      env,
      operationId,
      { data: { signals: input.symbols.map((symbol: string) => ({ symbol, ...tech })), summary: { direction: tech.direction, averageScore: tech.score } }, meta: result.meta },
      'Summarize the trading signals and overall bias in 3-5 short sentences.',
    )
  }
  if (operationId === 'intelligence.volume') {
    const vols = result.data.map(c => c.volume), current = vols.at(-1) ?? 0, average = sma(vols, Math.min(20, vols.length))
    return withProModel(
      env,
      operationId,
      { data: { symbol: input.symbols[0], current, average, ratio: average ? current / average : 0, spike: current > average * 2 }, meta: result.meta },
      'Interpret volume participation and whether a spike is meaningful in 3-5 short sentences.',
    )
  }
  if (operationId === 'intelligence.events') {
    const moves = result.data.slice(1).map((c, i) => ({ time: c.time, changePct: (c.close / result.data[i].close - 1) * 100 })).filter(v => Math.abs(v.changePct) >= 2)
    return withProModel(
      env,
      operationId,
      {
        data: { events: moves, derivedFrom: 'OHLCV movement threshold' },
        meta: { ...result.meta, limitations: [...result.meta.limitations, 'Events are price/volume-derived; no news claims are made'] },
      },
      'Summarize notable price events from the grounded list in 3-5 short sentences. Do not invent news.',
    )
  }
  if (operationId === 'intelligence.backtest') {
    let cash = input.strategy.initialCapital, position = 0, trades = 0
    for (let i = input.strategy.slowPeriod; i < result.data.length; i++) {
      const xs = result.data.slice(0, i + 1).map(c => c.close), f = sma(xs, input.strategy.fastPeriod), s = sma(xs, input.strategy.slowPeriod), p = xs.at(-1)!
      if (f > s && !position) { position = cash / p; cash = 0; trades++ }
      else if (f < s && position) { cash = position * p; position = 0; trades++ }
    }
    const end = cash + position * (result.data.at(-1)?.close ?? 0)
    return withProModel(
      env,
      operationId,
      {
        data: { initialCapital: input.strategy.initialCapital, finalEquity: end, returnPct: (end / input.strategy.initialCapital - 1) * 100, trades },
        meta: { ...result.meta, limitations: [...result.meta.limitations, 'Excludes fees, slippage, taxes, and market impact'] },
      },
      'Interpret this bounded backtest result and its limitations in 3-5 short sentences.',
    )
  }
  if (operationId === 'agent.decision') {
    return withProModel(
      env,
      operationId,
      {
        data: {
          action: tech.direction,
          confidence: Math.abs(tech.score - 50) * 2,
          risk: input.risk,
          maxPositionPct: input.risk === 'conservative' ? 5 : input.risk === 'aggressive' ? 20 : 10,
          rationale: `SMA/RSI regime is ${tech.regime}`,
        },
        meta: result.meta,
      },
      `Provide a risk-aware rationale for this ${input.risk} decision in 3-5 short sentences. Keep the action unchanged.`,
    )
  }
  if (operationId === 'agent.briefing') {
    return withProModel(
      env,
      operationId,
      { data: { symbol: input.symbols[0], bias: tech.direction, regime: tech.regime, score: tech.score, risks: ['Market volatility', 'Provider latency'] }, meta: result.meta },
      'Write a compact machine-readable market briefing narrative in 3-5 short sentences.',
    )
  }
  if (operationId === 'intelligence.report') {
    return withProModel(
      env,
      operationId,
      {
        data: {
          technicals: tech,
          signal: tech.direction,
          risk: tech.rsi14 > 70 ? 'overbought' : tech.rsi14 < 30 ? 'oversold' : 'normal',
        },
        meta: result.meta,
      },
      'Write a combined intelligence report narrative covering signal, technicals, and risk in 4-6 short sentences.',
    )
  }
  throw new FinalityError('not_implemented', `Operation ${operationId} is unavailable`, 501)
}
