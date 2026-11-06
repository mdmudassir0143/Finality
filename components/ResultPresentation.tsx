'use client'

import { Component, useMemo, useState, type ReactNode } from 'react'
import { isProEndpoint } from '@/lib/dashboard/catalog'
import { decodeReceipt, receiptExplorerUrl } from '@/lib/x402/client'

export type ResultEnvelope = {
  success?: boolean
  operationId?: string
  requestId?: string
  data?: unknown
  meta?: {
    source?: string
    provider?: string
    dataMode?: string
    synthetic?: boolean
    freshnessSeconds?: number
    limitations?: string[]
    fallbackReason?: string
    asOf?: string
    availabilityTrack?: string
  }
  payment?: { settlementId?: string; network?: string; asset?: string }
}

type Props = {
  result: ResultEnvelope
  receipt?: string | null
  title?: string
  /** Sample payload shown before paying: no settlement is claimed. */
  preview?: boolean
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** Text for a value that may be a string/number, else undefined (never render an object as a React child). */
function text(v: unknown): string | undefined {
  return typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined
}

/** Coerce whatever the merchant returned into an envelope that is safe to read. */
function normalizeEnvelope(result: unknown): ResultEnvelope {
  if (!isRecord(result)) return { data: result }
  const meta = isRecord(result.meta) ? result.meta : {}
  const payment = isRecord(result.payment) ? result.payment : {}
  return {
    ...(result as ResultEnvelope),
    operationId: text(result.operationId),
    requestId: text(result.requestId),
    meta: {
      source: text(meta.source),
      provider: text(meta.provider),
      dataMode: text(meta.dataMode),
      synthetic: meta.synthetic === true,
      freshnessSeconds: typeof meta.freshnessSeconds === 'number' && Number.isFinite(meta.freshnessSeconds) ? meta.freshnessSeconds : undefined,
      limitations: Array.isArray(meta.limitations) ? meta.limitations.filter((l): l is string => typeof l === 'string') : undefined,
      fallbackReason: text(meta.fallbackReason),
      asOf: text(meta.asOf),
      availabilityTrack: text(meta.availabilityTrack),
    },
    payment: { settlementId: text(payment.settlementId), network: text(payment.network), asset: text(payment.asset) },
  }
}

function formatDate(v: string | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

function labelize(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

function formatNumber(n: number, opts?: { compact?: boolean; digits?: number; style?: 'currency' | 'percent' | 'plain' }) {
  const digits = opts?.digits ?? (Math.abs(n) >= 1000 ? 2 : Math.abs(n) >= 1 ? 2 : 4)
  if (opts?.style === 'percent') {
    return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`
  }
  if (opts?.compact && Math.abs(n) >= 1_000) {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(n)
  }
  if (opts?.style === 'currency') {
    return new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', minimumFractionDigits: Math.min(2, digits), maximumFractionDigits: digits }).format(n)
  }
  return n.toLocaleString('en', { maximumFractionDigits: digits })
}

const TINYBARS_PER_HBAR = 100_000_000

function formatHbar(tinybars: number): string {
  return (tinybars / TINYBARS_PER_HBAR).toLocaleString('en', { maximumFractionDigits: 8 })
}

/** Hedera consensus timestamps look like `1700000000.123456789` (seconds.nanos). */
function formatConsensusTimestamp(value: unknown): string {
  const seconds = Number.parseFloat(String(value ?? ''))
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toLocaleString() : '—'
}

function formatValue(key: string, value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—'
    const k = key.toLowerCase()
    if (/(pct|percent|change|momentum|return)/.test(k)) return formatNumber(value, { style: 'percent' })
    if (/(price|equity|capital|amount)/.test(k) && Math.abs(value) < 1e12) return formatNumber(value, { style: 'currency', compact: Math.abs(value) >= 1e6 })
    if (/(volume|marketcap)/.test(k)) return formatNumber(value, { compact: true })
    if (/(score|confidence|rsi|ratio|rank)/.test(k)) return formatNumber(value, { digits: 1 })
    if (/time|timestamp/.test(k) && value > 1e11) return new Date(value).toLocaleString()
    if (/time|timestamp/.test(k) && value > 1e9) return new Date(value * 1000).toLocaleString()
    return formatNumber(value)
  }
  if (typeof value === 'string') {
    // Only epoch-looking strings under a time-like key are dates (balances and supplies are digit strings too).
    if (/time|timestamp|date/i.test(key) && /^\d{10,13}$/.test(value)) {
      const n = Number(value)
      return new Date(n > 1e12 ? n : n * 1000).toLocaleString()
    }
    return value
  }
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function toneFor(value: unknown): string {
  const s = String(value ?? '').toUpperCase()
  if (['BUY', 'BULL', 'BULLISH', 'YES', 'TRUE', 'TRENDING_UP', 'VALIDATED'].includes(s)) return 'text-foreground bg-muted border-border'
  if (['SELL', 'BEAR', 'BEARISH', 'NO', 'FALSE', 'TRENDING_DOWN', 'OVERBOUGHT', 'SPIKE'].includes(s)) return 'text-destructive bg-destructive/10 border-destructive/20'
  if (['HOLD', 'NEUTRAL', 'RANGING', 'NORMAL', 'BALANCED'].includes(s)) return 'text-foreground bg-muted border-border'
  if (['EXTREME FEAR', 'FEAR', 'OVERSOLD'].includes(s)) return 'text-destructive bg-destructive/10 border-destructive/20'
  if (['EXTREME GREED', 'GREED'].includes(s)) return 'text-foreground bg-muted border-border'
  return 'text-foreground bg-muted/40 border-border'
}

function Badge({ children, value }: { children?: ReactNode; value?: unknown }) {
  return (
    <span className={`inline-flex items-center rounded-none border px-2.5 py-0.5 text-xs font-semibold tracking-wide ${toneFor(value ?? children)}`}>
      {children ?? String(value)}
    </span>
  )
}

function PaymentCell({ result, receipt, preview }: { result: ResultEnvelope; receipt?: string | null; preview?: boolean }) {
  const decoded = useMemo(() => decodeReceipt(receipt), [receipt])
  const href = decoded ? receiptExplorerUrl(decoded) : null
  const id = decoded?.transaction || result.payment?.settlementId
  return (
    <div className="border border-border bg-muted/20 p-4 min-w-0">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Payment</div>
      <div className="font-bold mt-2 text-foreground">{preview ? 'Preview' : decoded && !decoded.success ? 'Failed' : 'Settled'}</div>
      <div className="text-[11px] text-muted-foreground mt-1 truncate mono" title={id}>
        {preview ? 'Not paid' : href ? (
          <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">{id}</a>
        ) : id || (receipt ? 'Receipt attached' : '—')}
      </div>
    </div>
  )
}

function MetaStrip({ result, receipt, preview }: { result: ResultEnvelope; receipt?: string | null; preview?: boolean }) {
  const pro = isProEndpoint(result.operationId || '')
  const fresh = result.meta?.freshnessSeconds
  const freshLabel = fresh == null ? '—' : fresh === 0 ? 'Instant' : fresh < 60 ? `${fresh}s` : fresh < 3600 ? `${Math.round(fresh / 60)}m` : `${Math.round(fresh / 3600)}h`

  // Pro / agent routes: only show payment — never surface fallback/synthetic status.
  if (pro) {
    return (
      <div className="grid sm:grid-cols-2 gap-3">
        <PaymentCell result={result} receipt={receipt} preview={preview} />
        <div className="border border-border bg-muted/20 p-4">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Route</div>
          <div className="font-bold mt-2 truncate">{result.operationId || '—'}</div>
          <div className="text-[11px] text-muted-foreground mt-1">Pro endpoint</div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="border border-border bg-muted/20 p-4">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Data status</div>
        <div className={`font-bold mt-2 ${result.meta?.synthetic ? 'text-foreground' : 'text-foreground'}`}>
          {result.meta?.synthetic ? 'Fallback · synthetic' : 'Live · verified'}
        </div>
      </div>
      <div className="border border-border bg-muted/20 p-4">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Source</div>
        <div className="font-bold mt-2 capitalize truncate">{result.meta?.source || result.meta?.provider || '—'}</div>
        <div className="text-[11px] text-muted-foreground mt-1">{result.meta?.dataMode || '—'}</div>
      </div>
      <div className="border border-border bg-muted/20 p-4">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Freshness</div>
        <div className="font-bold mt-2">{freshLabel}</div>
        <div className="text-[11px] text-muted-foreground mt-1 truncate">{formatDate(result.meta?.asOf)}</div>
      </div>
      <PaymentCell result={result} receipt={receipt} preview={preview} />
    </div>
  )
}

function MetricCard({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: string; accent?: string }) {
  return (
    <div className="border border-border bg-muted/10 p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-2 text-lg font-bold break-words ${accent || 'text-foreground'}`}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  )
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="border border-border bg-muted/10 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div className="text-xs font-bold text-muted-foreground tracking-wide">{title}</div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function DataTable({ rows, maxRows = 12 }: { rows: Record<string, unknown>[]; maxRows?: number }) {
  const columns = useMemo(() => {
    const keys = new Set<string>()
    rows.slice(0, maxRows).forEach(row => Object.keys(row).forEach(k => keys.add(k)))
    const preferred = ['rank', 'symbol', 'name', 'price', 'change24h', 'volume24h', 'direction', 'score', 'time', 'open', 'high', 'low', 'close', 'volume', 'value', 'classification', 'action', 'changePct']
    const ordered = [...preferred.filter(k => keys.has(k)), ...[...keys].filter(k => !preferred.includes(k))]
    return ordered.slice(0, 8)
  }, [rows, maxRows])

  if (!rows.length) return <div className="text-sm text-muted-foreground">No rows returned.</div>

  const shown = rows.slice(0, maxRows)
  return (
    <div className="overflow-auto max-h-80 -mx-1">
      <table className="w-full text-left text-sm min-w-[480px]">
        <thead className="sticky top-0 bg-background">
          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
            {columns.map(col => (
              <th key={col} className="px-3 py-2 font-semibold whitespace-nowrap">{labelize(col)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            <tr key={i} className="border-b border-border hover:bg-muted/30">
              {columns.map(col => {
                const v = row[col]
                const isSignal = /direction|action|bias|classification|regime|signal|risk/.test(col)
                return (
                  <td key={col} className="px-3 py-2.5 whitespace-nowrap align-middle">
                    {isSignal && (typeof v === 'string' || typeof v === 'boolean') ? (
                      <Badge value={v}>{String(v).replace(/_/g, ' ')}</Badge>
                    ) : (
                      <span className={typeof v === 'number' && /change|pct|momentum|return/.test(col) ? (v >= 0 ? 'text-foreground' : 'text-destructive') : 'text-foreground'}>
                        {formatValue(col, v)}
                      </span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > maxRows && (
        <div className="text-[11px] text-muted-foreground mt-3 px-1">Showing {maxRows} of {rows.length} rows · full payload in Raw JSON</div>
      )}
    </div>
  )
}

function ObjectMetrics({ data, exclude = [] }: { data: Record<string, unknown>; exclude?: string[] }) {
  const entries = Object.entries(data).filter(([k, v]) => !exclude.includes(k) && (typeof v !== 'object' || v === null))
  if (!entries.length) return null
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {entries.map(([key, value]) => {
        const isSignal = /direction|action|bias|classification|regime|signal|risk|validated|spike|generated/.test(key)
        return (
          <MetricCard
            key={key}
            label={labelize(key)}
            value={isSignal ? <Badge value={value}>{String(value).replace(/_/g, ' ')}</Badge> : formatValue(key, value)}
            accent={typeof value === 'number' && /change|pct|momentum|return/.test(key) ? (value >= 0 ? 'text-foreground' : 'text-destructive') : undefined}
          />
        )
      })}
    </div>
  )
}

function NestedBlocks({ data }: { data: Record<string, unknown> }) {
  const nested = Object.entries(data).filter(([, v]) => Array.isArray(v) || isRecord(v))
  return (
    <div className="space-y-4">
      {nested.map(([key, value]) => {
        if (Array.isArray(value)) {
          if (!value.length) return (
            <Section key={key} title={labelize(key)}>
              <div className="text-sm text-muted-foreground">Empty list</div>
            </Section>
          )
          if (value.every(isRecord)) {
            return (
              <Section key={key} title={labelize(key)} action={<span className="text-[11px] text-muted-foreground">{value.length} items</span>}>
                <DataTable rows={value as Record<string, unknown>[]} />
              </Section>
            )
          }
          return (
            <Section key={key} title={labelize(key)}>
              <div className="flex flex-wrap gap-2">
                {value.map((item, i) => (
                  <span key={i} className="border border-border bg-muted/20 px-3 py-1.5 text-sm text-foreground break-all">{formatValue(key, item)}</span>
                ))}
              </div>
            </Section>
          )
        }
        if (isRecord(value)) {
          return (
            <Section key={key} title={labelize(key)}>
              <ObjectMetrics data={value} />
              <div className="mt-4">
                <NestedBlocks data={value} />
              </div>
            </Section>
          )
        }
        return null
      })}
    </div>
  )
}

function FearGreedView({ rows }: { rows: Record<string, unknown>[] }) {
  const latest = rows[0] || {}
  const value = Number(latest.value ?? Number.NaN)
  const classification = String(latest.classification ?? '—')
  const angle = (Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 50) * 1.8 - 90
  return (
    <div className="space-y-4">
      <div className="border border-border bg-muted/20 p-6 flex flex-col sm:flex-row items-center gap-6">
        <div className="relative w-40 h-24 overflow-hidden">
          <div className="absolute inset-x-0 bottom-0 h-40 rounded-full border-[10px] border-border border-r-foreground/40 border-t-foreground/60 border-l-muted-foreground" />
          <div
            className="absolute left-1/2 bottom-0 origin-bottom h-20 w-0.5 bg-foreground transition-transform"
            style={{ transform: `translateX(-50%) rotate(${angle}deg)` }}
          />
          <div className="absolute left-1/2 bottom-0 -translate-x-1/2 w-3 h-3 rounded-full bg-foreground" />
        </div>
        <div className="text-center sm:text-left">
          <div className="text-4xl font-bold">{Number.isFinite(value) ? value : '—'}</div>
          <div className="mt-2"><Badge value={classification}>{classification}</Badge></div>
          <div className="text-xs text-muted-foreground mt-2">Crypto Fear & Greed index</div>
        </div>
      </div>
      {rows.length > 1 && <Section title="History"><DataTable rows={rows} /></Section>}
    </div>
  )
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const normalized = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

  const parts: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|https?:\/\/[^\s)]+)/g
  let last = 0
  let match: RegExpExecArray | null
  let i = 0
  while ((match = re.exec(normalized))) {
    if (match.index > last) parts.push(normalized.slice(last, match.index))
    const token = match[0]
    if (token.startsWith('**')) {
      parts.push(<strong key={`${keyPrefix}-b${i}`} className="font-semibold text-foreground">{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('*')) {
      parts.push(<em key={`${keyPrefix}-i${i}`} className="italic text-foreground">{token.slice(1, -1)}</em>)
    } else if (token.startsWith('`')) {
      parts.push(<code key={`${keyPrefix}-c${i}`} className="mono text-[11px] border border-border bg-muted/40 px-1.5 py-0.5 text-foreground">{token.slice(1, -1)}</code>)
    } else {
      parts.push(
        <a key={`${keyPrefix}-a${i}`} href={token} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2 hover:opacity-70">
          {token}
        </a>,
      )
    }
    last = match.index + token.length
    i += 1
  }
  if (last < normalized.length) parts.push(normalized.slice(last))
  return parts
}

function splitCellLines(cell: string): ReactNode {
  const chunks = cell
    .replace(/<br\s*\/?>/gi, '\n')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
  if (chunks.length <= 1) return <>{renderInline(cell.trim(), `c-${cell.slice(0, 12)}`)}</>
  return (
    <div className="space-y-1">
      {chunks.map((line, idx) => (
        <div key={idx} className={line.startsWith('•') || line.startsWith('-') ? 'pl-0' : ''}>
          {renderInline(line, `cl-${idx}`)}
        </div>
      ))}
    </div>
  )
}

function parseMarkdownTable(block: string): { headers: string[]; rows: string[][] } | null {
  const lines = block
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
  if (lines.length < 2 || !lines[0].includes('|')) return null
  const splitRow = (line: string) =>
    line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(c => c.trim())
  const headers = splitRow(lines[0])
  const sep = lines[1]
  if (!/^\|?[\s:-]+\|/.test(sep) && !/^[\s|:-]+$/.test(sep)) return null
  const rows = lines.slice(2).map(splitRow).filter(r => r.some(c => c.length > 0))
  return { headers, rows }
}

function MarkdownView({ content }: { content: string }) {
  const cleaned = content.replace(/\r\n/g, '\n').trim()

  type Segment =
    | { type: 'table'; headers: string[]; rows: string[][] }
    | { type: 'text'; text: string }

  const segments: Segment[] = []
  const lines = cleaned.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const looksLikeHeader = line.includes('|') && lines[i + 1] && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])
    if (looksLikeHeader) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].includes('|')) {
        tableLines.push(lines[i])
        i += 1
      }
      const table = parseMarkdownTable(tableLines.join('\n'))
      if (table) segments.push({ type: 'table', ...table })
      else segments.push({ type: 'text', text: tableLines.join('\n') })
      continue
    }
    const textLines: string[] = []
    while (i < lines.length) {
      const nextHeader = lines[i].includes('|') && lines[i + 1] && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])
      if (nextHeader) break
      textLines.push(lines[i])
      i += 1
    }
    const text = textLines.join('\n').trim()
    if (text) segments.push({ type: 'text', text })
  }

  return (
    <div className="space-y-4 text-sm leading-relaxed text-foreground">
      {segments.map((seg, si) => {
        if (seg.type === 'table') {
          return (
            <div key={si} className="overflow-auto border border-border bg-muted/20">
              <table className="w-full text-left text-sm min-w-[480px]">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {seg.headers.map((h, hi) => (
                      <th key={hi} className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold whitespace-nowrap">
                        {renderInline(h.replace(/\*\*/g, ''), `th-${si}-${hi}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {seg.rows.map((row, ri) => (
                    <tr key={ri} className="border-b border-border align-top hover:bg-muted/30">
                      {seg.headers.map((_, ci) => (
                        <td key={ci} className={`px-3 py-3 ${ci === 0 ? 'font-semibold text-foreground whitespace-nowrap' : 'text-muted-foreground'}`}>
                          {splitCellLines(row[ci] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }

        const blocks = seg.text.split(/\n{2,}/)
        return (
          <div key={si} className="space-y-3">
            {blocks.map((block, bi) => {
              const blockLines = block.split('\n')
              const isList = blockLines.filter(l => l.trim()).every(l => /^\s*([-*•]|\d+\.)\s+/.test(l))
              if (isList && blockLines.some(l => l.trim())) {
                return (
                  <ul key={bi} className="space-y-1.5 pl-1">
                    {blockLines.filter(l => l.trim()).map((line, li) => (
                      <li key={li} className="flex gap-2">
                        <span className="text-foreground shrink-0 mt-0.5">•</span>
                        <span>{renderInline(line.replace(/^\s*([-*•]|\d+\.)\s+/, ''), `li-${si}-${bi}-${li}`)}</span>
                      </li>
                    ))}
                  </ul>
                )
              }

              const heading = block.match(/^(#{1,3})\s+(.+)$/m)
              if (heading && blockLines.length === 1) {
                const level = heading[1].length
                const cls = level === 1 ? 'text-lg font-bold text-foreground' : level === 2 ? 'text-base font-bold text-foreground' : 'text-sm font-semibold text-foreground'
                return (
                  <div key={bi} className={cls}>
                    {renderInline(heading[2], `h-${si}-${bi}`)}
                  </div>
                )
              }

              if (/^\*\*[^*]+\*\*$/.test(block.trim()) && !block.includes('\n')) {
                return (
                  <h3 key={bi} className="text-base font-bold text-foreground tracking-tight">
                    {renderInline(block.trim(), `t-${si}-${bi}`)}
                  </h3>
                )
              }

              return (
                <p key={bi} className="whitespace-pre-wrap">
                  {blockLines.map((line, li) => {
                    const pieces = line.split(/<br\s*\/?>/gi)
                    return (
                      <span key={li}>
                        {li > 0 && <br />}
                        {pieces.map((piece, pi) => (
                          <span key={pi}>
                            {pi > 0 && <br />}
                            {renderInline(piece, `p-${si}-${bi}-${li}-${pi}`)}
                          </span>
                        ))}
                      </span>
                    )
                  })}
                </p>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

function ChatAnswer({ answer }: { answer: string; generatedByModel?: boolean }) {
  return (
    <div className="border border-border bg-muted/20 p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="text-xs font-bold text-foreground tracking-wide font-mono">ANALYST RESPONSE</div>
      </div>
      <MarkdownView content={answer} />
    </div>
  )
}

function presentByOperation(operationId: string | undefined, data: unknown): ReactNode {
  if (data == null) return <div className="text-sm text-muted-foreground">No data payload.</div>

  // Arrays at the root (quotes, assets, trending, fearGreed, candles)
  if (Array.isArray(data)) {
    const rows = data.filter(isRecord) as Record<string, unknown>[]
    if (operationId === 'market.fearGreed' || (rows[0] && 'classification' in rows[0] && 'value' in rows[0])) {
      return <FearGreedView rows={rows} />
    }
    if (operationId === 'market.candles' || (rows[0] && 'open' in rows[0] && 'close' in rows[0])) {
      const last = rows.at(-1)
      return (
        <div className="space-y-4">
          {last && (
            <div className="grid sm:grid-cols-4 gap-3">
              <MetricCard label="Last close" value={formatValue('close', last.close)} />
              <MetricCard label="High" value={formatValue('high', last.high)} accent="text-foreground" />
              <MetricCard label="Low" value={formatValue('low', last.low)} accent="text-destructive" />
              <MetricCard label="Candles" value={rows.length} />
            </div>
          )}
          <Section title="OHLCV" action={<span className="text-[11px] text-muted-foreground">{rows.length} bars</span>}>
            <DataTable rows={rows} maxRows={20} />
          </Section>
        </div>
      )
    }
    return (
      <Section title={operationId === 'market.trending' ? 'Trending assets' : operationId === 'market.assets' ? 'Matched assets' : 'Results'} action={<span className="text-[11px] text-muted-foreground">{rows.length} items</span>}>
        <DataTable rows={rows} />
      </Section>
    )
  }

  if (!isRecord(data)) {
    return <div className="text-sm text-foreground mono break-all">{String(data)}</div>
  }

  const modelAnswer =
    typeof data.answer === 'string' ? (
      <ChatAnswer answer={String(data.answer)} generatedByModel={Boolean(data.generatedByModel)} />
    ) : null
  const excludeModel = ['answer', 'generatedByModel'] as const

  if (operationId === 'ai.chat') {
    return (
      <div className="space-y-4">
        {modelAnswer}
        <ObjectMetrics data={data} exclude={[...excludeModel]} />
      </div>
    )
  }

  if (operationId === 'intelligence.signals' || Array.isArray(data.signals)) {
    const signals = Array.isArray(data.signals) ? (data.signals.filter(isRecord) as Record<string, unknown>[]) : []
    const summary = isRecord(data.summary) ? data.summary : null
    return (
      <div className="space-y-4">
        {modelAnswer}
        {summary && (
          <div className="grid sm:grid-cols-2 gap-3">
            <MetricCard label="Summary direction" value={<Badge value={summary.direction}>{String(summary.direction ?? '—')}</Badge>} />
            <MetricCard label="Average score" value={formatValue('score', summary.averageScore ?? summary.score)} />
          </div>
        )}
        <Section title="Signals" action={<span className="text-[11px] text-muted-foreground">{signals.length} symbols</span>}>
          <DataTable rows={signals} />
        </Section>
      </div>
    )
  }

  if (operationId === 'intelligence.technicals' || ('rsi14' in data && 'sma10' in data)) {
    return (
      <div className="space-y-4">
        {modelAnswer}
        <div className="flex flex-wrap gap-2">
          {'direction' in data && <Badge value={data.direction}>{String(data.direction)}</Badge>}
          {'regime' in data && <Badge value={data.regime}>{String(data.regime).replace(/_/g, ' ')}</Badge>}
        </div>
        <ObjectMetrics data={data} exclude={[...excludeModel]} />
      </div>
    )
  }

  if (operationId === 'intelligence.report') {
    const tech = isRecord(data.technicals) ? data.technicals : null
    return (
      <div className="space-y-4">
        {modelAnswer}
        <div className="grid sm:grid-cols-2 gap-3">
          <MetricCard label="Signal" value={<Badge value={data.signal}>{String(data.signal ?? '—')}</Badge>} />
          <MetricCard label="Risk" value={<Badge value={data.risk}>{String(data.risk ?? '—')}</Badge>} />
        </div>
        {tech && <Section title="Technicals"><ObjectMetrics data={tech} /></Section>}
      </div>
    )
  }

  if (operationId === 'intelligence.volume') {
    return (
      <div className="space-y-4">
        {modelAnswer}
        <div className="flex flex-wrap gap-2">
          {data.spike ? <Badge value="SPIKE">Volume spike</Badge> : <Badge value="NORMAL">Normal volume</Badge>}
        </div>
        <ObjectMetrics data={data} exclude={['spike', ...excludeModel]} />
      </div>
    )
  }

  if (operationId === 'intelligence.backtest') {
    const ret = Number(data.returnPct ?? 0)
    return (
      <div className="space-y-4">
        {modelAnswer}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard label="Initial capital" value={formatValue('initialCapital', data.initialCapital)} />
          <MetricCard label="Final equity" value={formatValue('finalEquity', data.finalEquity)} />
          <MetricCard label="Return" value={formatValue('returnPct', ret)} accent={ret >= 0 ? 'text-foreground' : 'text-destructive'} />
          <MetricCard label="Trades" value={formatValue('trades', data.trades)} />
        </div>
        <ObjectMetrics data={data} exclude={['initialCapital', 'finalEquity', 'returnPct', 'trades', ...excludeModel]} />
      </div>
    )
  }

  if (operationId === 'agent.decision') {
    return (
      <div className="space-y-4">
        {modelAnswer}
        <div className="border border-border bg-muted/30 p-5 flex flex-wrap items-center gap-4">
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">Action</div>
            <div className="mt-2"><Badge value={data.action}>{String(data.action ?? '—')}</Badge></div>
          </div>
          <div className="h-10 w-px bg-foreground/10 hidden sm:block" />
          <MetricCard label="Confidence" value={`${formatValue('confidence', data.confidence)}`} />
          <MetricCard label="Max position" value={`${formatValue('maxPositionPct', data.maxPositionPct)}%`} />
          <MetricCard label="Risk profile" value={<Badge value={data.risk}>{String(data.risk ?? '—')}</Badge>} />
        </div>
        {typeof data.rationale === 'string' && !modelAnswer && (
          <Section title="Rationale"><p className="text-sm text-muted-foreground leading-relaxed">{data.rationale}</p></Section>
        )}
      </div>
    )
  }

  if (operationId === 'agent.briefing') {
    const risks = Array.isArray(data.risks) ? data.risks : []
    return (
      <div className="space-y-4">
        {modelAnswer}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard label="Symbol" value={String(data.symbol ?? '—')} />
          <MetricCard label="Bias" value={<Badge value={data.bias}>{String(data.bias ?? '—')}</Badge>} />
          <MetricCard label="Regime" value={<Badge value={data.regime}>{String(data.regime ?? '—').replace(/_/g, ' ')}</Badge>} />
          <MetricCard label="Score" value={formatValue('score', data.score)} />
        </div>
        {!!risks.length && (
          <Section title="Risks">
            <ul className="space-y-2">
              {risks.map((r, i) => (
                <li key={i} className="bg-destructive/5 border border-destructive/20 px-3 py-2 text-sm text-destructive">{formatValue('risk', r)}</li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    )
  }

  if (operationId === 'agent.strategyParse' || Array.isArray(data.rules)) {
    const rules = Array.isArray(data.rules) ? (data.rules.filter(isRecord) as Record<string, unknown>[]) : []
    return (
      <div className="space-y-4">
        {modelAnswer}
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-lg font-bold">{String(data.name ?? 'Parsed strategy')}</div>
          <Badge value={data.validated ? 'VALIDATED' : 'INVALID'}>{data.validated ? 'Validated' : 'Needs review'}</Badge>
        </div>
        <Section title="Rules" action={<span className="text-[11px] text-muted-foreground">{rules.length} rules</span>}>
          <DataTable rows={rules} />
        </Section>
      </div>
    )
  }

  if (Array.isArray(data.events)) {
    return (
      <div className="space-y-4">
        {modelAnswer}
        {typeof data.derivedFrom === 'string' && <div className="text-xs text-muted-foreground">Derived from {data.derivedFrom}</div>}
        <Section title="Price events" action={<span className="text-[11px] text-muted-foreground">{(data.events as unknown[]).length} events</span>}>
          <DataTable rows={(data.events as unknown[]).filter(isRecord) as Record<string, unknown>[]} />
        </Section>
      </div>
    )
  }

  if (typeof data.answer === 'string') {
    return (
      <div className="space-y-4">
        {modelAnswer}
        <ObjectMetrics data={data} exclude={[...excludeModel]} />
      </div>
    )
  }

  if (operationId === 'onchain.hederaAccount' || operationId === 'onchain.hederaBalances') {
    const balance = isRecord(data.balance) ? data.balance : {}
    const tinybars = Number(balance.balance)
    const tokenSource = Array.isArray(data.tokens) ? data.tokens : Array.isArray(balance.tokens) ? balance.tokens : []
    const tokens = (tokenSource as unknown[]).filter(isRecord) as Record<string, unknown>[]
    const accountId = String(data.account ?? data.accountId ?? '—')
    return (
      <div className="space-y-4">
        <div className="grid sm:grid-cols-3 gap-3">
          <MetricCard label="Account" value={<span className="mono text-xs">{accountId}</span>} />
          <MetricCard
            label="HBAR balance"
            value={Number.isFinite(tinybars) ? `${formatHbar(tinybars)} HBAR` : '—'}
            hint={Number.isFinite(tinybars) ? `${tinybars.toLocaleString('en')} tinybars` : undefined}
            accent="text-foreground"
          />
          <MetricCard label="Snapshot" value={formatConsensusTimestamp(balance.timestamp)} />
        </div>
        <Section title="Token holdings" action={<span className="text-[11px] text-muted-foreground">{tokens.length} tokens</span>}>
          <DataTable rows={tokens} maxRows={25} />
        </Section>
      </div>
    )
  }

  if (Array.isArray(data.transactions)) {
    const txs = (data.transactions as unknown[]).filter(isRecord) as Record<string, unknown>[]
    return (
      <Section title="Transactions" action={<span className="text-[11px] text-muted-foreground">{txs.length} txs</span>}>
        <DataTable rows={txs} maxRows={25} />
      </Section>
    )
  }

  // Wrapped quotes shape from catalog examples
  if (Array.isArray(data.quotes)) {
    return <Section title="Quotes"><DataTable rows={(data.quotes as unknown[]).filter(isRecord) as Record<string, unknown>[]} /></Section>
  }
  if (Array.isArray(data.candles)) {
    return presentByOperation('market.candles', data.candles)
  }

  return (
    <div className="space-y-4">
      <ObjectMetrics data={data} />
      <NestedBlocks data={data} />
    </div>
  )
}

function Presented({ operationId, data }: { operationId?: string; data: unknown }) {
  return <>{presentByOperation(operationId, data)}</>
}

/** Never let an unexpected payload shape blank the page: fall back to the raw JSON below. */
class RenderGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.error('[finality-result] render failed', error)
  }
  render() {
    return this.state.failed ? <div className="text-sm text-muted-foreground">Could not format this response. See Raw JSON below.</div> : this.props.children
  }
}

export default function ResultPresentation({ result: input, receipt, title = 'Result', preview }: Props) {
  const [copied, setCopied] = useState(false)
  const result = useMemo(() => normalizeEnvelope(input), [input])
  const decoded = useMemo(() => decodeReceipt(receipt), [receipt])
  const payload = useMemo(() => {
    try {
      return JSON.stringify({ ...(isRecord(input) ? input : { data: input }), paymentResponseHeader: receipt ?? null, receipt: decoded }, null, 2)
    } catch {
      return String(input)
    }
  }, [input, receipt, decoded])

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(payload)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <MetaStrip result={result} receipt={receipt} preview={preview} />

      {result.meta?.synthetic && !preview && !isProEndpoint(result.operationId || '') && (
        <div className="border border-border bg-muted/20 px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground">
          Synthetic fallback{result.meta.fallbackReason ? ` · ${result.meta.fallbackReason}` : ''} · not live data
        </div>
      )}

      <Section
        title={title.toUpperCase()}
        action={
          <div className="flex items-center gap-2">
            {result.operationId && <span className="text-[11px] text-muted-foreground mono">{result.operationId}</span>}
            <button type="button" onClick={copyJson} className="text-[11px] rounded-none border border-border px-2.5 py-1 text-muted-foreground hover:text-foreground hover:border-foreground">
              {copied ? 'Copied' : 'Copy JSON'}
            </button>
          </div>
        }
      >
        <RenderGuard key={payload}>
          <Presented operationId={result.operationId} data={result.data} />
        </RenderGuard>
      </Section>

      <details className="border border-border bg-muted/10 group">
        <summary className="cursor-pointer p-4 text-sm text-muted-foreground list-none flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.14em]">Raw JSON</span>
          <span className="text-muted-foreground group-open:rotate-180 transition-transform">▾</span>
        </summary>
        <pre className="border-t border-border p-4 text-xs overflow-auto max-h-96 text-foreground mono">{payload}</pre>
      </details>

      {!isProEndpoint(result.operationId || '') && (
        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
          {result.requestId && <span>Request {result.requestId}</span>}
          {result.meta?.limitations?.length ? <span>{result.meta.limitations.join(' · ')}</span> : null}
        </div>
      )}
    </div>
  )
}

/** Deterministic sample payloads for UI preview without paying. */
export function sampleResultFor(operationId: string): ResultEnvelope {
  const base = {
    success: true as const,
    operationId,
    requestId: 'preview-0000-0000-0000-000000000001',
    meta: {
      source: 'preview',
      provider: 'sample',
      asOf: new Date().toISOString(),
      freshnessSeconds: 15,
      limitations: ['Sample preview only — not live market data'],
      availabilityTrack: 'durable',
      dataMode: 'mock',
      synthetic: true,
      fallbackReason: 'ui_preview',
    },
    payment: { settlementId: 'preview-settlement', network: 'hedera-mainnet', asset: 'USDC' },
  }

  const samples: Record<string, unknown> = {
    'market.quotes': [
      { symbol: 'BTC', price: 68420.55, change24h: 1.84, volume24h: 2_450_000_000 },
      { symbol: 'ETH', price: 3421.12, change24h: -0.62, volume24h: 980_000_000 },
    ],
    'market.assets': [
      { symbol: 'BTC', name: 'BTC', marketType: 'crypto', quoteAsset: 'USDT' },
      { symbol: 'ETH', name: 'ETH', marketType: 'crypto', quoteAsset: 'USDT' },
    ],
    'market.candles': Array.from({ length: 8 }, (_, i) => {
      const close = 67000 + i * 120
      return { time: Date.now() - (7 - i) * 3600_000, open: close - 40, high: close + 80, low: close - 90, close, volume: 1200 + i * 40 }
    }),
    'market.trending': [
      { rank: 1, symbol: 'BTC', price: 68420, change24h: 1.8, volume24h: 2_450_000_000 },
      { rank: 2, symbol: 'ETH', price: 3421, change24h: -0.6, volume24h: 980_000_000 },
      { rank: 3, symbol: 'SOL', price: 178.4, change24h: 3.1, volume24h: 420_000_000 },
    ],
    'market.fearGreed': [
      { value: 62, classification: 'Greed', timestamp: String(Math.floor(Date.now() / 1000)) },
      { value: 48, classification: 'Neutral', timestamp: String(Math.floor(Date.now() / 1000) - 86400) },
    ],
    'intelligence.signals': {
      signals: [
        { symbol: 'BTC', direction: 'BUY', score: 64, regime: 'trending_up', rsi14: 58.2, price: 68420 },
        { symbol: 'ETH', direction: 'HOLD', score: 51, regime: 'ranging', rsi14: 49.1, price: 3421 },
      ],
      summary: { direction: 'BUY', averageScore: 57.5 },
      answer: 'Mixed book with a slight BUY tilt from BTC trend strength.',
      generatedByModel: true,
    },
    'intelligence.technicals': { price: 68420, sma10: 67810, sma30: 66120, rsi14: 58.2, momentum: 2.4, regime: 'trending_up', direction: 'BUY', score: 64, answer: 'Trend bias is constructive with SMA10 above SMA30 and RSI mid-range.', generatedByModel: true },
    'intelligence.report': {
      technicals: { price: 68420, sma10: 67810, sma30: 66120, rsi14: 58.2, momentum: 2.4, regime: 'trending_up', direction: 'BUY', score: 64 },
      signal: 'BUY',
      risk: 'normal',
      answer: 'Combined report: mild bullish regime with normal RSI risk.',
      generatedByModel: true,
    },
    'intelligence.volume': { symbol: 'BTC', current: 4200, average: 1800, ratio: 2.33, spike: true, answer: 'Volume is elevated versus the 20-bar average; treat as a participation spike.', generatedByModel: true },
    'intelligence.events': {
      events: [
        { time: Date.now() - 7200_000, changePct: 2.4 },
        { time: Date.now() - 3600_000, changePct: -2.1 },
      ],
      derivedFrom: 'OHLCV movement threshold',
      answer: 'Two ≥2% moves appear in the window; no news claims are attached.',
      generatedByModel: true,
    },
    'intelligence.backtest': { initialCapital: 10000, finalEquity: 11240, returnPct: 12.4, trades: 6, answer: 'Bounded MA backtest finished ahead; fees and slippage are excluded.', generatedByModel: true },
    'agent.decision': { action: 'BUY', confidence: 28, risk: 'balanced', maxPositionPct: 10, rationale: 'SMA/RSI regime is trending_up with moderate conviction.', answer: 'SMA/RSI regime is trending_up with moderate conviction.', generatedByModel: true },
    'agent.briefing': { symbol: 'BTC', bias: 'BUY', regime: 'trending_up', score: 64, risks: ['Market volatility', 'Provider latency'], answer: 'Briefing: bullish bias in an uptrend regime; watch volatility and provider lag.', generatedByModel: true },
    'agent.strategyParse': {
      name: 'Parsed moving-average strategy',
      validated: true,
      rules: [
        { indicator: 'sma', operator: 'crosses_above', fastPeriod: 10, slowPeriod: 30, action: 'BUY' },
        { indicator: 'sma', operator: 'crosses_below', fastPeriod: 10, slowPeriod: 30, action: 'SELL' },
      ],
      answer: 'Parsed a 10/30 SMA cross strategy with BUY on cross above and SELL on cross below.',
      generatedByModel: true,
    },
    'ai.chat': {
      answer: 'BTC shows a constructive short-term bias with SMA10 above SMA30. Treat as analysis only — verify live data before acting.',
      generatedByModel: true,
    },
    'onchain.hederaAccount': { account: '0.0.1001', balance: { balance: 12_500_000_000, timestamp: '1700000000.000000000' } },
    'onchain.hederaBalances': { accountId: '0.0.1001', balance: { balance: 12_500_000_000 }, tokens: [{ token_id: '0.0.429274', balance: 2_500_000 }] },
    'onchain.hederaToken': { token_id: '0.0.429274', name: 'USDC', symbol: 'USDC', decimals: '6' },
    'onchain.hederaTransaction': { transactions: [{ transaction_id: '0.0.1001@1700000000.000000000', result: 'SUCCESS' }] },
    'onchain.hederaTopic': { messages: [{ consensus_timestamp: '1700000000.000000000', message: 'ZXhhbXBsZQ==' }] },
    'onchain.hederaNetworkSupply': { released_supply: '1000000000000000000', total_supply: '5000000000000000000' },
    'onchain.hederaNetworkNodes': { nodes: [{ node_id: 0, description: 'example' }] },
    'onchain.hederaBlocks': { blocks: [{ number: 100, timestamp: '1700000000.000000000' }] },
  }

  return { ...base, data: samples[operationId] ?? { operationId, note: 'No sample mapped for this endpoint yet' } }
}
