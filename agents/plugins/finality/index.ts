/**
 * finality-intelligence: a Hedera Agent Kit plugin that lets an agent browse and buy Finality's x402 endpoints.
 *
 * Tools (all query-type: they never build a Hedera transaction through the kit; payment happens inside the
 * x402 MerchantSession, which enforces the spend policy and writes HCS spend records):
 *  - finality_catalog_tool  free   list paid operations with price and an example input
 *  - finality_budget_tool   free   spent / remaining budget for this run
 *  - finality_call_tool     paid   buy one operation and return its data plus the payment receipt
 */
import { z } from 'zod4'
import type { Client } from '@hiero-ledger/sdk'
import { BaseTool, untypedQueryOutputParser, type Context, type Plugin } from '@hashgraph/hedera-agent-kit'
import type { MerchantSession, PaidCallOutcome } from '../../../agent/src/session'

export const FINALITY_CATALOG_TOOL = 'finality_catalog_tool'
export const FINALITY_BUDGET_TOOL = 'finality_budget_tool'
export const FINALITY_CALL_TOOL = 'finality_call_tool'

/** Keeps tool results small enough for the model context. */
export function clip(value: unknown, max = 4000): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > max ? `${text.slice(0, max)}… [truncated ${text.length - max} chars]` : text
}

const noParams = () => z.object({})

class CatalogTool extends BaseTool<Record<string, never>, Record<string, never>> {
  method = FINALITY_CATALOG_TOOL
  name = 'Finality catalog'
  description =
    'List the paid Finality market/intelligence/Hedera endpoints you can buy with finality_call_tool. ' +
    'Free. Returns operationId, price (USD), description and an example input for each. Call this first.'
  parameters = noParams()
  outputParser = untypedQueryOutputParser

  constructor(private readonly session: MerchantSession) {
    super()
  }
  async normalizeParams(p: Record<string, never>) {
    return p
  }
  async coreAction() {
    return {
      merchant: this.session.discovery.merchant,
      operations: this.session.catalog.map((e) => ({
        operationId: e.operationId,
        price: e.price,
        description: e.description,
        exampleInput: e.requestExample ?? {},
      })),
    }
  }
  async shouldSecondaryAction() {
    return false
  }
  async secondaryAction(result: unknown) {
    return result
  }
}

class BudgetTool extends BaseTool<Record<string, never>, Record<string, never>> {
  method = FINALITY_BUDGET_TOOL
  name = 'Finality budget'
  description = 'Free. Returns how much of this run’s USD budget is spent and remaining, and the per-call cap.'
  parameters = noParams()
  outputParser = untypedQueryOutputParser

  constructor(private readonly session: MerchantSession) {
    super()
  }
  async normalizeParams(p: Record<string, never>) {
    return p
  }
  async coreAction() {
    const { ledger, policy } = this.session
    return { spentUsd: ledger.spentUsd, remainingUsd: ledger.remainingUsd, maxPerCallUsd: policy.maxPerCallUsd }
  }
  async shouldSecondaryAction() {
    return false
  }
  async secondaryAction(result: unknown) {
    return result
  }
}

const callParameters = () =>
  z.object({
    operationId: z.string().describe('operationId from finality_catalog_tool, e.g. "market.quotes"'),
    input: z
      .string()
      .optional()
      .describe('JSON object with the operation input, shaped like its exampleInput, e.g. {"symbols":["HBAR","BTC"]}. Omit for defaults.'),
  })
type CallParams = z.infer<ReturnType<typeof callParameters>>
type CallNormalised = { operationId: string; input: Record<string, unknown> }

/** The last outcome per call, read by the runner to attach payment receipts to the trace. */
export type CallSink = (outcome: PaidCallOutcome) => void

class CallTool extends BaseTool<CallParams, CallNormalised> {
  method = FINALITY_CALL_TOOL
  name = 'Finality paid call'
  description =
    'Buy one Finality endpoint over x402 and return its data. COSTS MONEY (the price in the catalog), paid on Hedera ' +
    'and checked against this run’s spend policy (budget, per-call cap, verified merchant). Only buy what the goal needs; ' +
    'never buy the same operation with the same input twice.'
  parameters = callParameters()
  outputParser = untypedQueryOutputParser

  constructor(
    private readonly session: MerchantSession,
    private readonly sink: CallSink,
  ) {
    super()
  }

  async normalizeParams(params: CallParams): Promise<CallNormalised> {
    const entry = this.session.entry(params.operationId)
    if (!entry) throw new Error(`Unknown operationId "${params.operationId}". Call ${FINALITY_CATALOG_TOOL} for the list.`)
    let input: Record<string, unknown> = { ...(entry.requestExample ?? {}) }
    if (params.input?.trim()) {
      let parsed: unknown
      try {
        parsed = JSON.parse(params.input)
      } catch {
        throw new Error('input must be a JSON object string, e.g. {"symbols":["HBAR"]}')
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('input must be a JSON object')
      input = parsed as Record<string, unknown>
    }
    return { operationId: entry.operationId, input }
  }

  async coreAction(params: CallNormalised, _context: Context, _client: Client) {
    const entry = this.session.entry(params.operationId)!
    const outcome = await this.session.call(entry, params.input)
    this.sink(outcome)
    if (outcome.decision !== 'paid') {
      return { paid: false, decision: outcome.decision, reason: outcome.reason, operationId: outcome.operationId }
    }
    return {
      paid: true,
      operationId: outcome.operationId,
      usd: outcome.usd,
      paymentTx: outcome.paymentTx,
      synthetic: outcome.synthetic,
      data: JSON.stringify(outcome.data ?? null).length > 3500 ? clip(outcome.data, 3500) : outcome.data,
    }
  }

  async shouldSecondaryAction() {
    return false
  }
  async secondaryAction(result: unknown) {
    return result
  }

  async handleError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return { raw: { error: message }, humanMessage: `finality_call_tool failed: ${message}` }
  }
}

export function finalityPlugin(session: MerchantSession, sink: CallSink): Plugin {
  return {
    name: 'finality-intelligence',
    version: '1.0.0',
    description: 'Browse and buy Finality x402 market, intelligence and Hedera endpoints under a spend policy.',
    tools: () => [new CatalogTool(session), new BudgetTool(session), new CallTool(session, sink)],
  }
}
