import type { Hono } from 'hono'
import { readAgent, type AgentProfile, type Erc8004Config } from '../../lib/evm/erc8004'
import { FinalityError } from '../../lib/contracts/errors'
import type { Env } from '../config/env'
import { erc8004FromEnv } from '../erc8004/config'

export type AgentReader = (config: Erc8004Config, agentId: bigint) => Promise<AgentProfile>

function evmExplorer(env: Env, address: string) {
  return `https://hashscan.io/${env.X402_NETWORK === 'hedera-mainnet' ? 'mainnet' : 'testnet'}/account/${address}`
}

export const ERC8004_CACHE_TTL_MS = 60_000
export const ERC8004_LOOKUP_TIMEOUT_MS = 15_000
const MAX_CACHED_AGENTS = 500

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new FinalityError('provider_timeout', 'Hedera JSON-RPC relay timed out', 504, true)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

/**
 * Free, read-only ERC-8004 lookups on Hedera EVM (identity + reputation).
 * Each lookup is 4-5 RPC reads on an unauthenticated route, so successful profiles are cached briefly,
 * concurrent lookups for the same agent share one in-flight read, and every lookup has a hard deadline.
 */
export function registerErc8004Routes(app: Hono, env: Env, reader: AgentReader = readAgent) {
  const cache = new Map<string, { expires: number; value: AgentProfile & { ownerUrl: string } }>()
  const inflight = new Map<string, Promise<AgentProfile & { ownerUrl: string }>>()

  const lookup = async (agentIdRaw: string) => {
    const config = erc8004FromEnv(env)
    if (!config) throw new FinalityError('not_configured', 'ERC-8004 registries are not configured for this network', 503, false)
    if (!/^\d{1,30}$/.test(agentIdRaw)) throw new FinalityError('invalid_request', 'agentId must be a non-negative integer', 400, false)
    const agentId = BigInt(agentIdRaw)
    const key = agentId.toString()
    const hit = cache.get(key)
    if (hit && hit.expires > Date.now()) return hit.value
    const pending = inflight.get(key)
    if (pending) return pending
    const request = fetchProfile(config, agentId).then((value) => {
      if (cache.size >= MAX_CACHED_AGENTS) cache.delete(cache.keys().next().value as string)
      cache.set(key, { expires: Date.now() + ERC8004_CACHE_TTL_MS, value })
      return value
    }).finally(() => inflight.delete(key))
    inflight.set(key, request)
    return request
  }

  const fetchProfile = async (config: Erc8004Config, agentId: bigint) => {
    try {
      const profile = await withDeadline(reader(config, agentId), ERC8004_LOOKUP_TIMEOUT_MS)
      return { ...profile, ownerUrl: evmExplorer(env, profile.owner) }
    } catch (error) {
      if (error instanceof FinalityError) throw error
      const message = String((error as Error)?.message ?? error)
      if (/nonexistent|ERC721NonexistentToken|invalid token/i.test(message)) {
        throw new FinalityError('not_found', `ERC-8004 agent ${agentId} not found`, 404, false)
      }
      throw new FinalityError('provider_unavailable', 'Hedera JSON-RPC relay unavailable', 503, true)
    }
  }

  app.get('/v1/erc8004/merchant', async c => {
    if (!env.ERC8004_MERCHANT_AGENT_ID) {
      return c.json({ success: true, data: { registered: false } })
    }
    return c.json({ success: true, data: { registered: true, ...(await lookup(env.ERC8004_MERCHANT_AGENT_ID)) } })
  })

  app.get('/v1/erc8004/agents/:agentId', async c => c.json({ success: true, data: await lookup(c.req.param('agentId')) }))
}
