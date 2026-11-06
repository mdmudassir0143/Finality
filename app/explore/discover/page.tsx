'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { CATEGORIES, PROVIDERS, isExternal, type DiscoverCategory, type DiscoverProvider } from '@/lib/discovery/providers'
import { cn } from '@/lib/utils'

type Filter = 'all' | DiscoverCategory

export default function DiscoverPage() {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return PROVIDERS.filter((p) => {
      if (filter !== 'all' && p.category !== filter) return false
      if (!q) return true
      return `${p.name} ${p.description} ${p.tags.join(' ')}`.toLowerCase().includes(q)
    })
  }, [filter, query])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: PROVIDERS.length }
    for (const p of PROVIDERS) c[p.category] = (c[p.category] ?? 0) + 1
    return c
  }, [])

  const sections = CATEGORIES.map((cat) => ({ ...cat, items: matches.filter((p) => p.category === cat.id) })).filter((s) => s.items.length)

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight uppercase">Discover</h1>
          <p className="mt-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
            Hedera ecosystem · {PROVIDERS.length} services
          </p>
        </div>
        <div className="relative w-full md:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search services"
            aria-label="Search services"
            className="h-9 rounded-none pl-8 text-sm"
          />
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="Category">
        {(['all', ...CATEGORIES.map((c) => c.id)] as Filter[]).map((id) => {
          const label = id === 'all' ? 'All' : CATEGORIES.find((c) => c.id === id)!.label
          const active = filter === id
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(id)}
              className={cn(
                '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-xs uppercase tracking-wider transition-colors',
                active ? 'border-foreground font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {label} <span className="mono text-[10px] text-muted-foreground">{counts[id] ?? 0}</span>
            </button>
          )
        })}
      </div>

      {sections.length === 0 ? (
        <div className="border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No services match.{' '}
          <button
            type="button"
            className="underline underline-offset-4 hover:text-foreground"
            onClick={() => {
              setQuery('')
              setFilter('all')
            }}
          >
            Reset
          </button>
        </div>
      ) : (
        sections.map((section) => (
          <section key={section.id} className="space-y-3" aria-labelledby={`cat-${section.id}`}>
            <div className="flex items-baseline justify-between">
              <h2 id={`cat-${section.id}`} className="text-xs font-semibold uppercase tracking-[0.14em]">
                {section.label}
              </h2>
              <span className="mono text-[10px] text-muted-foreground">{section.items.length}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {section.items.map((p) => (
                <ProviderCard key={p.id} provider={p} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}

function ProviderCard({ provider: p }: { provider: DiscoverProvider }) {
  return (
    <article className="group flex flex-col border border-border p-4 transition-colors hover:border-foreground/40">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden border border-border bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static brand icons (png/svg) */}
          <img src={p.logo} alt="" width={40} height={40} loading="lazy" className="h-full w-full object-contain" />
        </span>
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{p.name}</h3>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {CATEGORIES.find((c) => c.id === p.category)?.label}
          </div>
        </div>
      </div>
      <p className="mt-3 flex-1 text-sm text-muted-foreground">{p.description}</p>
      <div className="mt-3 flex flex-wrap gap-1">
        {p.tags.map((t) => (
          <span key={t} className="border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {t}
          </span>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-4 border-t border-border pt-3 text-xs">
        <SmartLink href={p.website} label={`${p.name} website`}>
          {isExternal(p.website) ? 'Website' : 'Open'}
        </SmartLink>
        <SmartLink href={p.source} label={`${p.name} on Hedera`} muted>
          Hedera source
        </SmartLink>
      </div>
    </article>
  )
}

function SmartLink({ href, label, muted, children }: { href: string; label: string; muted?: boolean; children: React.ReactNode }) {
  const className = cn('inline-flex items-center gap-1 underline-offset-4 hover:underline', muted ? 'text-muted-foreground hover:text-foreground' : 'font-semibold')
  if (!isExternal(href)) {
    return (
      <Link href={href} className={className} aria-label={label}>
        {children}
      </Link>
    )
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} aria-label={`${label} (opens in a new tab)`}>
      {children}
      <ArrowUpRight className="h-3 w-3" aria-hidden />
    </a>
  )
}
