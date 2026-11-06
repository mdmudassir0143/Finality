import { FinalityError } from '../../contracts/errors'

export type MirrorEnv = { MIRROR_NODE_URL: string }

async function mirrorGet(base: string, path: string) {
  const url = `${base.replace(/\/$/, '')}${path}`
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      throw new FinalityError('provider_unavailable', `Mirror Node HTTP ${response.status}`, 503, true)
    }
    return response.json()
  } catch (error) {
    if (error instanceof FinalityError) throw error
    throw new FinalityError('provider_unavailable', 'Hedera Mirror Node unavailable', 503, true)
  }
}

export async function fetchHederaAccount(env: MirrorEnv, accountId: string) {
  return mirrorGet(env.MIRROR_NODE_URL, `/api/v1/accounts/${encodeURIComponent(accountId)}`)
}

export async function fetchHederaBalances(env: MirrorEnv, accountId: string, limit = 25) {
  const account = await fetchHederaAccount(env, accountId)
  const tokens = await mirrorGet(
    env.MIRROR_NODE_URL,
    `/api/v1/accounts/${encodeURIComponent(accountId)}/tokens?limit=${Math.min(100, Math.max(1, limit))}`,
  )
  return {
    accountId,
    balance: account.balance ?? null,
    tokens: tokens.tokens ?? [],
    links: tokens.links ?? null,
  }
}

export async function fetchHederaToken(env: MirrorEnv, tokenId: string) {
  return mirrorGet(env.MIRROR_NODE_URL, `/api/v1/tokens/${encodeURIComponent(tokenId)}`)
}

/** Accepts SDK form `0.0.x@seconds.nanos` or Mirror form `0.0.x-seconds-nanos`. */
export const HEDERA_TRANSACTION_ID_REGEX = /^(\d+\.\d+\.\d+)(?:@(\d+)\.(\d+)|-(\d+)-(\d+))$/

/**
 * Normalize a Hedera transaction id to the Mirror Node path form.
 * `0.0.1001@1700000000.123456789` → `0.0.1001-1700000000-123456789`.
 */
export function toMirrorTransactionId(transactionId: string): string {
  const match = HEDERA_TRANSACTION_ID_REGEX.exec(transactionId.trim())
  if (!match) {
    throw new FinalityError(
      'invalid_request',
      'transactionId must look like 0.0.x@seconds.nanos or 0.0.x-seconds-nanos',
      400,
      false,
    )
  }
  const [, account, atSeconds, atNanos, dashSeconds, dashNanos] = match
  return `${account}-${atSeconds ?? dashSeconds}-${atNanos ?? dashNanos}`
}

export async function fetchHederaTransaction(env: MirrorEnv, transactionId: string) {
  return mirrorGet(env.MIRROR_NODE_URL, `/api/v1/transactions/${toMirrorTransactionId(transactionId)}`)
}

export async function fetchHederaTopicMessages(env: MirrorEnv, topicId: string, limit = 25) {
  return mirrorGet(
    env.MIRROR_NODE_URL,
    `/api/v1/topics/${encodeURIComponent(topicId)}/messages?limit=${Math.min(100, Math.max(1, limit))}&order=desc`,
  )
}

export async function fetchHederaNetworkSupply(env: MirrorEnv) {
  return mirrorGet(env.MIRROR_NODE_URL, `/api/v1/network/supply`)
}

export async function fetchHederaNetworkNodes(env: MirrorEnv) {
  return mirrorGet(env.MIRROR_NODE_URL, `/api/v1/network/nodes?limit=25`)
}

export async function fetchHederaBlocks(env: MirrorEnv, limit = 10) {
  return mirrorGet(
    env.MIRROR_NODE_URL,
    `/api/v1/blocks?limit=${Math.min(25, Math.max(1, limit))}&order=desc`,
  )
}

export async function fetchHederaOperation(
  env: MirrorEnv,
  operationId: string,
  input: Record<string, unknown>,
) {
  switch (operationId) {
    case 'onchain.hederaAccount':
      return fetchHederaAccount(env, String(input.accountId))
    case 'onchain.hederaBalances':
      return fetchHederaBalances(env, String(input.accountId), Number(input.limit ?? 25))
    case 'onchain.hederaToken':
      return fetchHederaToken(env, String(input.tokenId))
    case 'onchain.hederaTransaction':
      return fetchHederaTransaction(env, String(input.transactionId))
    case 'onchain.hederaTopic':
      return fetchHederaTopicMessages(env, String(input.topicId), Number(input.limit ?? 25))
    case 'onchain.hederaNetworkSupply':
      return fetchHederaNetworkSupply(env)
    case 'onchain.hederaNetworkNodes':
      return fetchHederaNetworkNodes(env)
    case 'onchain.hederaBlocks':
      return fetchHederaBlocks(env, Number(input.limit ?? 10))
    default:
      throw new FinalityError('not_found', `Unknown Hedera operation ${operationId}`, 404, false)
  }
}
