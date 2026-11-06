'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { fetchCatalog, metaFor, isProEndpoint, CATEGORY_ORDER, type CatalogEndpoint } from '@/lib/dashboard/catalog'

type CategoryFilter = 'All' | (typeof CATEGORY_ORDER)[number]

const CATEGORY_TABS: CategoryFilter[] = ['All', ...CATEGORY_ORDER]

const runHref = (operationId: string) => `/explore/run?op=${encodeURIComponent(operationId)}`

export default function EndpointsPage() {
  const [catalog, setCatalog] = useState<CatalogEndpoint[]>([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<CategoryFilter>('All')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setCatalog(await fetchCatalog())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load catalog')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of catalog) {
      const cat = metaFor(item.operationId).category
      counts.set(cat, (counts.get(cat) || 0) + 1)
    }
    return counts
  }, [catalog])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return catalog.filter((item) => {
      const m = metaFor(item.operationId)
      if (category !== 'All' && m.category !== category) return false
      if (!q) return true
      return `${m.title} ${m.category} ${item.operationId} ${item.path} ${item.description}${isProEndpoint(item.operationId) ? ' pro' : ''}`
        .toLowerCase()
        .includes(q)
    })
  }, [catalog, query, category])

  return (
    <div className="space-y-6 font-mono">
      <div className="flex items-end justify-between gap-4">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight uppercase">Endpoints</h1>
        <Button asChild className="rounded-none text-[11px] uppercase tracking-wider">
          <Link href="/explore/run">Run_Endpoint</Link>
        </Button>
      </div>

      <div className="space-y-3">
        <div role="tablist" aria-label="Endpoint categories" className="flex items-center gap-1 overflow-x-auto border-b border-border">
          {CATEGORY_TABS.map((tab) => {
            const active = category === tab
            const count = tab === 'All' ? catalog.length : categoryCounts.get(tab) || 0
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setCategory(tab)}
                className={cn(
                  'inline-flex items-center gap-2 px-3 py-2.5 text-[10px] uppercase tracking-[0.14em] border-b-2 -mb-px transition-colors whitespace-nowrap',
                  active ? 'border-foreground text-foreground font-semibold' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <span>{tab}</span>
                <span className={cn('tabular-nums', active ? 'text-foreground' : 'text-muted-foreground/70')}>{count}</span>
              </button>
            )
          })}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter endpoints"
            aria-label="Filter endpoints"
            className="pl-9 h-10 rounded-none font-mono"
          />
        </div>
      </div>

      {error ? (
        <div className="border border-destructive/30 bg-destructive/5 p-4 flex items-center justify-between gap-3 text-sm text-destructive">
          <span className="break-words">Catalog unavailable · {error}</span>
          <Button variant="outline" size="sm" className="rounded-none h-8 text-[10px] uppercase" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="border border-border overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="px-4 py-3 font-medium">Endpoint</th>
                <th className="px-4 py-3 font-medium">Route</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium text-right">Price</th>
                <th className="px-4 py-3 font-medium w-px" aria-label="Run" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                    Loading catalog…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                    {catalog.length === 0 ? 'No endpoints available.' : 'No endpoints match.'}
                  </td>
                </tr>
              ) : (
                filtered.map((item) => {
                  const m = metaFor(item.operationId)
                  return (
                    <tr key={item.operationId} className="group border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <Link href={runHref(item.operationId)} className="flex items-center gap-2 font-semibold hover:underline underline-offset-2">
                          {m.title}
                          {isProEndpoint(item.operationId) && (
                            <span className="px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wider bg-sky-500/15 text-sky-700 dark:text-sky-400">
                              Pro
                            </span>
                          )}
                        </Link>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{item.operationId}</div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={cn(
                              'inline-block shrink-0 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider',
                              item.method === 'GET'
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                                : 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
                            )}
                          >
                            {item.method}
                          </span>
                          <span className="text-muted-foreground truncate max-w-[220px]" title={item.path}>
                            {item.path}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{m.category}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{item.price}</td>
                      <td className="px-4 py-3">
                        <Button asChild variant="outline" size="sm" className="rounded-none h-8 text-[10px] uppercase tracking-wider">
                          <Link href={runHref(item.operationId)}>
                            Run
                            <ArrowRight className="h-3 w-3" />
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
