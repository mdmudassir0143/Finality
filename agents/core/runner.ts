import { generateText, stepCountIs, type LanguageModel, type Tool } from 'ai'
import type { Client } from '@hiero-ledger/sdk'
import { AgentMode } from '@hashgraph/hedera-agent-kit'
import { HederaAIToolkit } from '@hashgraph/hedera-agent-kit-ai-sdk'
import type { MerchantSession, PaidCallOutcome } from '../../agent/src/session'
import { FINALITY_BUDGET_TOOL, FINALITY_CALL_TOOL, FINALITY_CATALOG_TOOL, finalityPlugin } from '../plugins/finality'
import type { AgentSpec } from './spec'
import { citationsIn, type RunTrace, type SourceKind, type ToolCallTrace } from './trace'

export type RunInput = {
  spec: AgentSpec
  goal: string
  model: LanguageModel
  modelId: string
  /** Hedera client for the kit's query tools (operator = the agent's own account). */
  client: Client
  accountId: string
  network: string
  /** Open x402 session with the merchant (required when spec.finality). */
  session?: MerchantSession
  log?: (line: string) => void
  now?: () => Date
}

const META_TOOLS = new Set([FINALITY_CATALOG_TOOL, FINALITY_BUDGET_TOOL])

/**
 * Run one AgentSpec on one goal: Hedera Agent Kit tools (spec.hederaPlugins + the Finality plugin) exposed to the
 * model through the Vercel AI SDK, bounded by spec.maxSteps. Every tool result is wrapped as
 * { sourceId, result } so the model can cite it as [S#]; the trace keeps timings, payments and token usage.
 */
export async function runSpec(input: RunInput): Promise<RunTrace> {
  const { spec, goal, session } = input
  const log = input.log ?? (() => {})
  const now = input.now ?? (() => new Date())
  const startedAt = now()
  const toolCalls: ToolCallTrace[] = []
  let lastPaid: PaidCallOutcome | null = null
  let nextSource = 1

  if (spec.finality && !session) throw new Error(`${spec.id} buys Finality data but no merchant session was opened`)

  const plugins = [...spec.hederaPlugins, ...(spec.finality && session ? [finalityPlugin(session, (o) => (lastPaid = o))] : [])]
  const toolkit = new HederaAIToolkit({
    client: input.client,
    configuration: { plugins, context: { mode: AgentMode.AUTONOMOUS, accountId: input.accountId } },
  })

  const tools: Record<string, Tool> = {}
  for (const [name, tool] of Object.entries(toolkit.getTools())) {
    const execute = tool.execute
    if (!execute) {
      tools[name] = tool
      continue
    }
    const kind: SourceKind = META_TOOLS.has(name) ? 'meta' : name === FINALITY_CALL_TOOL ? 'finality' : 'hedera'
    tools[name] = {
      ...tool,
      execute: async (args: unknown, options: Parameters<NonNullable<Tool['execute']>>[1]) => {
        const t0 = Date.now()
        lastPaid = null
        const row: ToolCallTrace = { sourceId: null, kind, tool: name, args, ok: false, ms: 0 }
        toolCalls.push(row)
        try {
          const result = await execute(args, options)
          row.ms = Date.now() - t0
          const failed = isFailure(result)
          row.ok = !failed
          if (failed) row.error = failureText(result)
          const paid = lastPaid as PaidCallOutcome | null
          if (paid) {
            row.payment = { operationId: paid.operationId, usd: paid.usd, tx: paid.paymentTx, sha256: paid.sha256, decision: paid.decision, synthetic: paid.synthetic }
            row.ok = paid.decision === 'paid'
            if (!row.ok) row.error = paid.reason
          }
          if (row.ok && kind !== 'meta') row.sourceId = `S${nextSource++}`
          log(`  ${row.ok ? '✓' : '✗'} ${name}${row.sourceId ? ` → ${row.sourceId}` : ''} (${row.ms} ms)${row.error ? `: ${row.error}` : ''}`)
          return row.sourceId ? { sourceId: row.sourceId, result } : { result }
        } catch (error) {
          row.ms = Date.now() - t0
          row.error = error instanceof Error ? error.message : String(error)
          log(`  ✗ ${name}: ${row.error}`)
          return { error: row.error }
        }
      },
    } as Tool
  }

  const budgetUsd = session?.policy.budgetUsd ?? 0
  const trace: RunTrace = {
    agentId: spec.id,
    agentName: spec.name,
    goal,
    model: input.modelId,
    startedAt: startedAt.toISOString(),
    durationMs: 0,
    steps: 0,
    finishReason: 'error',
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    toolCalls,
    spentUsd: 0,
    budgetUsd,
    text: '',
    unknownCitations: [],
  }

  try {
    log(`${spec.name} · ${input.modelId} · ${Object.keys(tools).length} tools · budget $${budgetUsd}`)
    const result = await generateText({
      model: input.model,
      system: spec.system({ network: input.network, budgetUsd, today: startedAt.toISOString().slice(0, 10) }),
      prompt: goal,
      tools,
      stopWhen: stepCountIs(spec.maxSteps),
    })
    trace.text = result.text
    trace.steps = result.steps.length
    trace.finishReason = String(result.finishReason)
    const usage = result.totalUsage
    trace.usage = {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      totalTokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
    }
  } catch (error) {
    trace.error = error instanceof Error ? error.message : String(error)
    log(`  run failed: ${trace.error}`)
  } finally {
    trace.durationMs = now().getTime() - startedAt.getTime()
    trace.spentUsd = session?.ledger.spentUsd ?? 0
    const known = new Set(toolCalls.map((c) => c.sourceId).filter(Boolean))
    trace.unknownCitations = citationsIn(trace.text).filter((id) => !known.has(id))
  }
  return trace
}

/** Hedera Agent Kit query tools report failures in their parsed output instead of throwing. */
function isFailure(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false
  const r = result as { raw?: { error?: unknown; status?: unknown }; error?: unknown }
  return Boolean(r.error || r.raw?.error)
}

function failureText(result: unknown): string {
  const r = result as { raw?: { error?: unknown }; error?: unknown; humanMessage?: string }
  return String(r.humanMessage ?? r.raw?.error ?? r.error ?? 'tool failed').slice(0, 200)
}
