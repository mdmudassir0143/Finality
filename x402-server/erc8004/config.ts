import { agentRegistryId, erc8004Config, type Erc8004Config } from '../../lib/evm/erc8004'
import type { Env } from '../config/env'

export function erc8004FromEnv(env: Env): Erc8004Config | null {
  return erc8004Config(env.X402_NETWORK, {
    rpcUrl: env.EVM_RPC_URL,
    identityRegistry: env.ERC8004_IDENTITY_REGISTRY,
    reputationRegistry: env.ERC8004_REPUTATION_REGISTRY,
  })
}

/** Discovery block advertised by the merchant once it is registered in ERC-8004. */
export function erc8004Discovery(env: Env) {
  const config = erc8004FromEnv(env)
  if (!config || !env.ERC8004_MERCHANT_AGENT_ID) return null
  return {
    standard: 'ERC-8004',
    chainId: config.network === 'hedera-mainnet' ? 295 : 296,
    agentRegistry: agentRegistryId(config),
    identityRegistry: config.identityRegistry,
    reputationRegistry: config.reputationRegistry,
    agentId: Number(env.ERC8004_MERCHANT_AGENT_ID),
  }
}
