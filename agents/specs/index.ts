import type { AgentSpec } from '../core/spec'
import { intelligenceAgent } from './intelligence'

/** All built-in agents. New agents (auditor, risk, on-chain analyst, user-built) register here. */
export const AGENTS: Record<string, AgentSpec> = {
  [intelligenceAgent.id]: intelligenceAgent,
}

export function getAgent(id: string): AgentSpec {
  const spec = AGENTS[id]
  if (!spec) throw new Error(`Unknown agent "${id}". Available: ${Object.keys(AGENTS).join(', ')}`)
  return spec
}
