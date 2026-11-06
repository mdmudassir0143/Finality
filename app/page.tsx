import Link from 'next/link'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import ProductFlowAnimation from '@/components/ProductFlowAnimation'
import { FACILITATOR } from '@/lib/facilitator'

const STEPS = [
  { num: '01', title: 'Connect', desc: 'HashPack, MetaMask, or email. No signup, no API key.' },
  { num: '02', title: 'Pick an endpoint', desc: 'Market, intelligence, AI, agent, and Hedera reads.' },
  { num: '03', title: 'Pay the 402', desc: 'Sign the exact price for that one call.' },
  { num: '04', title: 'Get JSON', desc: 'Live result plus a settlement receipt on HashScan.' },
]

const CATALOG = [
  { name: 'Market data', count: 7, detail: 'Quotes, candles, trending, token prices, fear & greed.' },
  { name: 'Intelligence', count: 6, detail: 'Signals, technicals, reports, volume, events, backtests.' },
  { name: 'AI & agents', count: 4, detail: 'Chat, decisions, briefings, strategy parsing.' },
  { name: 'Hedera', count: 8, detail: 'Accounts, balances, tokens, topics, blocks, network.' },
]

const RAILS = [
  { label: 'HashPack', value: 'HBAR · USDC', note: `Native Hedera · USDC ${FACILITATOR.usdcTokenId}` },
  { label: 'MetaMask', value: 'fUSD', note: 'Hedera EVM' },
  { label: 'Email', value: 'fUSD', note: 'Magic wallet · Hedera EVM' },
]

const TRUST = [
  ['Network', 'Hedera testnet'],
  ['Protocol', 'x402'],
  ['Audit', 'HCS topic'],
  ['Identity', 'ERC-8004'],
] as const

const TOTAL = CATALOG.reduce((sum, c) => sum + c.count, 0)

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{children}</p>
  )
}

export default function Page() {
  return (
    <div className="bg-background text-foreground">
      {/* Hero */}
      <section className="border-b border-border px-4 md:px-10">
        <div className="mx-auto max-w-6xl py-20 md:py-32">
          <Label>Finality · x402 on Hedera</Label>
          <h1 className="mt-6 text-4xl font-bold leading-[0.95] tracking-tighter sm:text-6xl md:text-7xl">
            Pay for the call.
            <br />
            Not the plan.
          </h1>
          <p className="mt-6 max-w-lg text-base text-muted-foreground md:text-lg">
            Market intelligence for people and agents. Priced per request, settled on Hedera.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/explore"
              className="inline-flex h-11 items-center justify-center gap-2 bg-foreground px-6 font-mono text-xs uppercase tracking-wider text-background transition-opacity hover:opacity-90"
            >
              Open dashboard
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link
              href="/explore/endpoints"
              className="inline-flex h-11 items-center justify-center border border-border px-6 font-mono text-xs uppercase tracking-wider transition-colors hover:bg-muted"
            >
              Browse endpoints
            </Link>
          </div>
          <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            HashPack · MetaMask · Email
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="border-b border-border px-4 md:px-10">
        <div className="mx-auto max-w-6xl py-20 md:py-24">
          <Label>How it works</Label>
          <h2 className="mt-4 text-2xl font-bold tracking-tight md:text-4xl">One signature. One response.</h2>
          <ol className="mt-10 grid border-l border-t border-border sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step) => (
              <li key={step.num} className="border-b border-r border-border p-6">
                <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">{step.num}</span>
                <h3 className="mt-3 font-mono text-sm font-bold uppercase tracking-wide">{step.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{step.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <ProductFlowAnimation />

      {/* Catalog */}
      <section className="border-b border-border px-4 md:px-10">
        <div className="mx-auto max-w-6xl py-20 md:py-24">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <Label>Catalog</Label>
              <h2 className="mt-4 text-2xl font-bold tracking-tight md:text-4xl">{TOTAL} live endpoints.</h2>
            </div>
            <Link
              href="/explore/endpoints"
              className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
            >
              View all
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          <ul className="mt-10 border-t border-border">
            {CATALOG.map((item) => (
              <li
                key={item.name}
                className="grid grid-cols-[3rem_1fr] items-baseline gap-x-4 gap-y-1 border-b border-border py-5 md:grid-cols-[4rem_12rem_1fr] md:gap-8"
              >
                <span className="font-mono text-sm tabular-nums text-muted-foreground">
                  {String(item.count).padStart(2, '0')}
                </span>
                <span className="font-semibold">{item.name}</span>
                <span className="col-start-2 text-sm text-muted-foreground md:col-start-auto">{item.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Rails */}
      <section className="border-b border-border px-4 md:px-10">
        <div className="mx-auto max-w-6xl py-20 md:py-24">
          <Label>Payment rails</Label>
          <h2 className="mt-4 text-2xl font-bold tracking-tight md:text-4xl">Three ways to pay.</h2>
          <div className="mt-10 grid border-l border-t border-border md:grid-cols-3">
            {RAILS.map((rail) => (
              <div key={rail.label} className="border-b border-r border-border p-6">
                <Label>{rail.label}</Label>
                <p className="mt-3 font-mono text-lg font-bold">{rail.value}</p>
                <p className="mt-1 text-sm text-muted-foreground">{rail.note}</p>
              </div>
            ))}
          </div>
          <dl className="mt-10 grid grid-cols-2 gap-6 md:grid-cols-4">
            {TRUST.map(([label, value]) => (
              <div key={label}>
                <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</dt>
                <dd className="mt-2 font-mono text-sm font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 md:px-10">
        <div className="mx-auto max-w-6xl py-20 md:py-28">
          <h2 className="text-3xl font-bold leading-[0.95] tracking-tighter md:text-5xl">
            Skip the seat.
            <br />
            Run the request.
          </h2>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/explore"
              className="inline-flex h-11 items-center justify-center gap-2 bg-foreground px-6 font-mono text-xs uppercase tracking-wider text-background transition-opacity hover:opacity-90"
            >
              Open dashboard
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link
              href="/docs"
              className="inline-flex h-11 items-center justify-center border border-border px-6 font-mono text-xs uppercase tracking-wider transition-colors hover:bg-muted"
            >
              API docs
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
