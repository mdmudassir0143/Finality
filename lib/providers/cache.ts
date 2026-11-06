/**
 * Tiny TTL cache with request coalescing. Keys are derived from caller input (symbols, addresses, ids), so the
 * store is bounded: expired entries are swept and, past MAX_ENTRIES, the oldest entries are evicted.
 */
export const MAX_CACHE_ENTRIES = 2_000

const values = new Map<string,{expires:number,value:unknown}>()
const pending = new Map<string,Promise<unknown>>()

function store(key: string, ttlMs: number, value: unknown) {
  const now = Date.now()
  values.delete(key)
  if (values.size >= MAX_CACHE_ENTRIES) {
    for (const [k, v] of values) if (v.expires <= now) values.delete(k)
    for (const k of values.keys()) {
      if (values.size < MAX_CACHE_ENTRIES) break
      values.delete(k)
    }
  }
  values.set(key, { expires: now + ttlMs, value })
}

export async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const now=Date.now(), hit=values.get(key)
  if(hit && hit.expires>now) return hit.value as T
  if(hit) values.delete(key)
  const existing=pending.get(key) as Promise<T>|undefined
  if(existing) return existing
  const request=loader().then(value=>{ store(key,ttlMs,value); return value }).finally(()=>pending.delete(key))
  pending.set(key,request)
  return request
}

export const cacheSize = () => values.size
