import type { Metadata } from 'next'
import { loadAgents } from '@/lib/agents/data'
import AgentsView from '@/components/agents/AgentsView'

export const metadata: Metadata = {
  title: 'Agents',
  description: 'Finality agents on Hedera: HCS-11 identities, tools, spend policy, benchmarks and live activity.',
}

/** Registry and benchmark files are read on the server; balances and activity load live in the browser. */
export default function AgentsPage() {
  return <AgentsView agents={loadAgents()} />
}
