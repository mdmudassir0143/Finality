import type { AgentProfile } from '../../lib/evm/erc8004'
import type { CatalogEntry } from './planner'

export type MerchantIdentity = {
  standard: 'ERC-8004'
  chainId: number
  agentRegistry: string
  identityRegistry: string
  reputationRegistry: string
  agentId: number
}

type WellKnownResource = { url: string; method: string; network: string; payTo: string; asset: string; amount: string }

export type Discovery = {
  merchant: string
  name: string
  network: string
  facilitator?: string
  identity: MerchantIdentity | null
  auditTopicId: string | null
  /** The single payTo the merchant advertises (null if resources disagree). */
  payTo: string | null
  catalog: CatalogEntry[]
  /** `${METHOD} ${path}|${asset}` → advertised atomic amount. */
  advertised: Map<string, bigint>
}

export const advertisedKey = (method: string, path: string, asset: string) => `${method.toUpperCase()} ${path}|${asset}`

/** Discover a merchant purely from its public documents: `/.well-known/x402` and `/v1/catalog`. */
export async function discoverMerchant(merchant: string, fetchFn: typeof fetch = fetch): Promise<Discovery> {
  const base = merchant.replace(/\/$/, '')
  const [wellKnownRes, catalogRes] = await Promise.all([fetchFn(`${base}/.well-known/x402`), fetchFn(`${base}/v1/catalog`)])
  if (!wellKnownRes.ok) throw new Error(`${base}/.well-known/x402 returned ${wellKnownRes.status}`)
  if (!catalogRes.ok) throw new Error(`${base}/v1/catalog returned ${catalogRes.status}`)
  const wellKnown = (await wellKnownRes.json()) as {
    name: string
    network?: string
    facilitator?: string
    identity?: MerchantIdentity
    audit?: { topicId: string }
    resources?: WellKnownResource[]
  }
  const catalog = ((await catalogRes.json()) as { data: CatalogEntry[] }).data

  const advertised = new Map<string, bigint>()
  // The payee is taken from the merchant's own network only: a merchant can also advertise other rails (e.g. fUSD
  // on Hedera EVM with a 0x payee), which must not make the native payee look ambiguous. Disagreement within the
  // native network still yields null (fail closed).
  const payTos = new Set<string>()
  for (const r of wellKnown.resources ?? []) {
    if (!wellKnown.network || r.network === wellKnown.network) payTos.add(r.payTo)
    if (/^\d+$/.test(r.amount)) advertised.set(advertisedKey(r.method, new URL(r.url).pathname, r.asset), BigInt(r.amount))
  }

  return {
    merchant: base,
    name: wellKnown.name,
    network: wellKnown.network ?? 'unknown',
    facilitator: wellKnown.facilitator,
    identity: wellKnown.identity ?? null,
    auditTopicId: wellKnown.audit?.topicId ?? null,
    payTo: payTos.size === 1 ? [...payTos][0] : null,
    catalog,
    advertised,
  }
}

/**
 * An identity counts as verified when the on-chain registration file (ERC-8004 agentURI) lists this exact
 * agentId in this registry and declares x402 support.
 */
export function isIdentityVerified(identity: MerchantIdentity | null, profile: AgentProfile | null): boolean {
  if (!identity || !profile?.registration) return false
  const reg = profile.registration
  return (
    reg.x402Support === true &&
    reg.registrations.some((r) => r.agentId === identity.agentId && r.agentRegistry === identity.agentRegistry)
  )
}
