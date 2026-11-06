import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { scoreTask, summarize, type BenchSuite, type BenchTask } from '../../../agents/bench/score'
import type { RunTrace, ToolCallTrace } from '../../../agents/core/trace'

const trace = (over: Partial<RunTrace> & { calls?: ToolCallTrace[] } = {}): RunTrace => ({
  agentId: 'intelligence', agentName: 'x', goal: 'g', model: 'm', startedAt: '2026-11-06T00:00:00Z', durationMs: 2000, steps: 3,
  finishReason: 'stop', usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, spentUsd: 0, budgetUsd: 0.5,
  text: '## Answer\nHBAR is $0.20 [S1].', unknownCitations: [], toolCalls: over.calls ?? [], ...over,
})

const paid = (op: string, sourceId = 'S1'): ToolCallTrace => ({
  sourceId, kind: 'finality', tool: 'finality_call_tool', args: { operationId: op }, ok: true, ms: 100,
  payment: { operationId: op, usd: 0.15, tx: '0.0.1@1.1', sha256: 'a'.repeat(64), decision: 'paid', synthetic: false },
})

const task: BenchTask = { id: 't', goal: 'g', budgetUsd: 0.5, maxUsd: 0.3, mustUseAny: ['market.quotes'], mustMention: ['HBAR', '\\$|USD'], minCitations: 1 }

describe('benchmark scoring', () => {
  it('passes a cited answer from the right paid source within cost', () => {
    const s = scoreTask(task, trace({ calls: [paid('market.quotes')], spentUsd: 0.15 }))
    expect(s.pass).toBe(true)
    expect(s.score).toBe(1)
  })

  it('fails the free-tools task when the agent paid for something it could read for free', () => {
    const free: BenchTask = { id: 'f', goal: 'g', budgetUsd: 0.5, maxUsd: 0, mustUseAny: ['get_hbar_balance_query_tool', 'onchain.hederaAccount'] }
    const s = scoreTask(free, trace({ calls: [paid('onchain.hederaAccount')], spentUsd: 0.25 }))
    expect(s.pass).toBe(false)
    expect(s.checks.find((c) => c.name === 'free-tools-only')?.pass).toBe(false)
    expect(s.checks.find((c) => c.name === 'right-source')?.pass).toBe(true)
  })

  it('counts only successful calls and flags invented citations', () => {
    const denied: ToolCallTrace = { ...paid('market.quotes', ''), sourceId: null, ok: false, payment: { ...paid('market.quotes').payment!, decision: 'denied', tx: null } }
    const s = scoreTask({ ...task, mustUseAll: ['market.quotes'] }, trace({ calls: [denied], unknownCitations: ['S1'] }))
    expect(s.checks.find((c) => c.name === 'right-source')?.pass).toBe(false)
    expect(s.checks.find((c) => c.name === 'all-sources')?.pass).toBe(false)
    expect(s.checks.find((c) => c.name === 'no-invented-citations')?.pass).toBe(false)
  })

  it('summarizes a suite and the shipped suite file is valid', () => {
    const suite = JSON.parse(readFileSync('agents/bench/tasks/intelligence.json', 'utf8')) as BenchSuite
    expect(suite.tasks.length).toBeGreaterThanOrEqual(5)
    for (const t of suite.tasks) {
      expect(t.maxUsd).toBeLessThanOrEqual(t.budgetUsd)
      for (const p of t.mustMention ?? []) expect(() => new RegExp(p, 'i')).not.toThrow()
    }
    const scores = [scoreTask(task, trace({ calls: [paid('market.quotes')], spentUsd: 0.15 })), scoreTask(task, trace({ error: 'boom', text: '' }))]
    const sum = summarize(suite, 'mock', scores, 'now')
    expect(sum).toMatchObject({ tasks: 2, passed: 1, passRate: 0.5, totalSpentUsd: 0.15 })
  })
})

describe('provider errors', () => {
  it('marks quota / overload failures as ERROR and keeps them out of the pass rate', () => {
    const quota = scoreTask(task, trace({ error: 'Failed after 3 attempts. Last error: AI_APICallError: You exceeded your current quota', text: '' }))
    const overload = scoreTask(task, trace({ error: 'This model is currently experiencing high demand', text: '' }))
    const agentBug = scoreTask(task, trace({ error: 'Cannot read properties of undefined', text: '' }))
    expect([quota.status, overload.status, agentBug.status]).toEqual(['error', 'error', 'fail'])
    const ok = scoreTask(task, trace({ calls: [paid('market.quotes')], spentUsd: 0.15 }))
    const sum = summarize({ suite: 's', agent: 'a', description: '', tasks: [] }, 'm', [ok, quota, overload], 'now')
    expect(sum).toMatchObject({ tasks: 3, errors: 2, passed: 1, passRate: 1, meanScore: 1 })
  })
})
