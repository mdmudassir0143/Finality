import type { Context } from 'hono'
import type { Env } from '../config/env'
import { parseRequest } from '../schemas'
import { executeOperation } from '../services/operation'
import { FinalityError } from '../../lib/contracts/errors'

const numericKeys = new Set(['limit', 'max', 'assetId', 'applicationId', 'round'])
const booleanKeys = new Set(['headerOnly'])

function query(c: Context) {
  const q = c.req.queries(), value: Record<string,unknown> = {}
  for (const [key,values] of Object.entries(q)) {
    const items = values ?? []
    if (key === 'symbols' || key === 'addresses') {
      value[key] = items.flatMap(v => v.split(',')).map(v => v.trim()).filter(Boolean)
    } else if (numericKeys.has(key)) {
      value[key] = Number(items[0])
    } else if (booleanKeys.has(key)) {
      value[key] = items[0] === 'true' || items[0] === '1'
    } else {
      value[key] = items[0]
    }
  }
  return value
}

/**
 * POST body. An empty body means "use defaults"; anything else must be a JSON object. A malformed body used to
 * be silently replaced by `{}`, so a paying caller got (and was charged for) default data instead of a 400.
 * Throwing here keeps the response >= 400, which the x402 middleware treats as "do not settle".
 */
async function body(c: Context): Promise<unknown> {
  const text = await c.req.text()
  if (!text.trim()) return {}
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch {
    throw new FinalityError('invalid_request', 'Request body must be valid JSON', 400, false)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new FinalityError('invalid_request', 'Request body must be a JSON object', 400, false)
  }
  return parsed
}

export function operationHandler(env: Env, operationId: string) {
  return async (c: Context) => {
    const raw = c.req.method === 'GET' ? query(c) : await body(c)
    const input = parseRequest(operationId, raw)
    const result = await executeOperation(env, operationId, input)
    const settlementId = c.res.headers.get('Payment-Response') ?? c.res.headers.get('PAYMENT-RESPONSE') ?? 'settled-by-facilitator'
    return c.json({ success:true, operationId, requestId:c.get('requestId'), data:result.data, meta:result.meta, payment:{ network: env.X402_NETWORK, assets:['USDC','HBAR'], settlementId } })
  }
}
