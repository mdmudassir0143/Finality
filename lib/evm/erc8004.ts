import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseEventLogs,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { hedera, hederaTestnet } from 'viem/chains'

/**
 * ERC-8004 "Trustless Agents" on Hedera EVM.
 *
 * Uses the canonical registries from erc-8004/erc-8004-contracts (UUPS proxies, getVersion() = "2.0.0"),
 * which are already deployed on Hedera testnet. Hedera EVM is reached through the Hashio JSON-RPC relay.
 * The same secp256k1 key that controls a Hedera ECDSA account (0.0.x) controls its EVM alias (0x…).
 */
export const ERC8004_DEPLOYMENTS = {
  'hedera-testnet': {
    chainId: 296,
    identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e' as Address,
    reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713' as Address,
  },
} as const

export type Erc8004Network = 'hedera-testnet' | 'hedera-mainnet'

export const REGISTRATION_TYPE = 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1'

export const identityRegistryAbi = parseAbi([
  'function register(string agentURI) returns (uint256 agentId)',
  'function setAgentURI(uint256 agentId, string newURI)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function balanceOf(address owner) view returns (uint256)',
  'function getAgentWallet(uint256 agentId) view returns (address)',
  'function getVersion() pure returns (string)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
  'event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy)',
])

export const reputationRegistryAbi = parseAbi([
  'function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)',
  'function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)',
  'function getClients(uint256 agentId) view returns (address[])',
  'function readAllFeedback(uint256 agentId, address[] clientAddresses, string tag1, string tag2, bool includeRevoked) view returns (address[] clients, uint64[] feedbackIndexes, int128[] values, uint8[] valueDecimals, string[] tag1s, string[] tag2s, bool[] revokedStatuses)',
  'function getLastIndex(uint256 agentId, address clientAddress) view returns (uint64)',
  'function getIdentityRegistry() view returns (address)',
  'event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)',
])

export type Erc8004Config = {
  network: Erc8004Network
  rpcUrl?: string
  identityRegistry: Address
  reputationRegistry: Address
}

export function erc8004Config(
  network: Erc8004Network,
  overrides: { rpcUrl?: string; identityRegistry?: string; reputationRegistry?: string } = {},
): Erc8004Config | null {
  const defaults = network === 'hedera-testnet' ? ERC8004_DEPLOYMENTS['hedera-testnet'] : null
  const identityRegistry = (overrides.identityRegistry || defaults?.identityRegistry) as Address | undefined
  const reputationRegistry = (overrides.reputationRegistry || defaults?.reputationRegistry) as Address | undefined
  if (!identityRegistry || !reputationRegistry) return null
  return { network, rpcUrl: overrides.rpcUrl || undefined, identityRegistry, reputationRegistry }
}

export function chainFor(network: Erc8004Network) {
  return network === 'hedera-mainnet' ? hedera : hederaTestnet
}

/** `{namespace}:{chainId}:{identityRegistry}` per ERC-8004. */
export function agentRegistryId(config: Erc8004Config): string {
  return `eip155:${chainFor(config.network).id}:${config.identityRegistry}`
}

export function publicClientFor(config: Erc8004Config): PublicClient {
  return createPublicClient({ chain: chainFor(config.network), transport: http(config.rpcUrl) }) as PublicClient
}

/**
 * Client for read-only lookups served to HTTP callers. viem's default (10s timeout x 4 attempts with backoff)
 * can hold a request for ~45s when the relay is down; reads here fail fast instead.
 */
export function readClientFor(config: Erc8004Config): PublicClient {
  return createPublicClient({
    chain: chainFor(config.network),
    transport: http(config.rpcUrl, { timeout: 6_000, retryCount: 1 }),
  }) as PublicClient
}

/** Normalize a Hedera ECDSA private key (hex with or without 0x) for viem. DER keys are not accepted here. */
export function toViemPrivateKey(raw: string): Hex {
  const hex = raw.trim().replace(/^0x/i, '')
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('EVM signing needs the raw 32-byte ECDSA private key in hex (0x… from the Hedera portal)')
  }
  return `0x${hex}` as Hex
}

export function walletClientFor(config: Erc8004Config, privateKey: string) {
  const account = privateKeyToAccount(toViemPrivateKey(privateKey))
  return createWalletClient({ account, chain: chainFor(config.network), transport: http(config.rpcUrl) })
}

// ---------------------------------------------------------------------------------------------
// Registration file (agent card)

export type RegistrationService = { name: string; endpoint: string; version?: string }

export type RegistrationFile = {
  type: typeof REGISTRATION_TYPE
  name: string
  description: string
  image?: string
  services: RegistrationService[]
  x402Support: boolean
  active: boolean
  registrations: Array<{ agentId: number; agentRegistry: string }>
  supportedTrust: string[]
}

export function buildRegistrationFile(input: {
  name: string
  description: string
  image?: string
  services: RegistrationService[]
  x402Support: boolean
  agentId?: bigint | number | null
  agentRegistry: string
}): RegistrationFile {
  return {
    type: REGISTRATION_TYPE,
    name: input.name,
    description: input.description,
    ...(input.image ? { image: input.image } : {}),
    services: input.services,
    x402Support: input.x402Support,
    active: true,
    registrations:
      input.agentId != null ? [{ agentId: Number(input.agentId), agentRegistry: input.agentRegistry }] : [],
    supportedTrust: ['reputation'],
  }
}

/** On-chain registration file, as allowed by ERC-8004 (`data:application/json;base64,…`). */
export function toDataUri(file: RegistrationFile): string {
  return `data:application/json;base64,${Buffer.from(JSON.stringify(file), 'utf8').toString('base64')}`
}

export function parseAgentUri(uri: string): RegistrationFile | null {
  const prefix = 'data:application/json;base64,'
  if (!uri.startsWith(prefix)) return null
  try {
    return JSON.parse(Buffer.from(uri.slice(prefix.length), 'base64').toString('utf8')) as RegistrationFile
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------------------------
// Writes

/** Register an agent with an initial URI, then rewrite the URI so the file lists its own agentId. */
export async function registerAgent(
  config: Erc8004Config,
  privateKey: string,
  makeFile: (agentId: bigint | null) => RegistrationFile,
) {
  const wallet = walletClientFor(config, privateKey)
  const publicClient = publicClientFor(config)
  const registerHash = await wallet.writeContract({
    address: config.identityRegistry,
    abi: identityRegistryAbi,
    functionName: 'register',
    args: [toDataUri(makeFile(null))],
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash: registerHash })
  if (receipt.status !== 'success') throw new Error(`register() reverted: ${registerHash}`)
  const [event] = parseEventLogs({ abi: identityRegistryAbi, eventName: 'Registered', logs: receipt.logs })
  if (!event) throw new Error(`No Registered event in ${registerHash}`)
  const agentId = event.args.agentId
  const uriHash = await updateAgentUri(config, privateKey, agentId, makeFile(agentId))
  return { agentId, owner: wallet.account.address, registerHash, uriHash }
}

export async function updateAgentUri(config: Erc8004Config, privateKey: string, agentId: bigint, file: RegistrationFile) {
  const wallet = walletClientFor(config, privateKey)
  const hash = await wallet.writeContract({
    address: config.identityRegistry,
    abi: identityRegistryAbi,
    functionName: 'setAgentURI',
    args: [agentId, toDataUri(file)],
  })
  const receipt = await publicClientFor(config).waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`setAgentURI() reverted: ${hash}`)
  return hash
}

/**
 * Leave feedback for an agent. ERC-8004 forbids the agent's owner (or an approved operator) from rating itself,
 * so this must be sent by a different account (e.g. the buying agent rating the merchant).
 * `score` is 0–100 with no decimals; tags categorize it (e.g. "x402", operationId).
 */
export async function giveFeedback(
  config: Erc8004Config,
  privateKey: string,
  input: { agentId: bigint; score: number; tag1: string; tag2: string; endpoint: string; feedbackURI?: string; feedbackHash?: Hex },
) {
  const score = Math.max(0, Math.min(100, Math.round(input.score)))
  const wallet = walletClientFor(config, privateKey)
  const hash = await wallet.writeContract({
    address: config.reputationRegistry,
    abi: reputationRegistryAbi,
    functionName: 'giveFeedback',
    args: [
      input.agentId,
      BigInt(score),
      0,
      input.tag1.slice(0, 64),
      input.tag2.slice(0, 64),
      input.endpoint.slice(0, 200),
      input.feedbackURI ?? '',
      input.feedbackHash ?? (`0x${'0'.repeat(64)}` as Hex),
    ],
  })
  const receipt = await publicClientFor(config).waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`giveFeedback() reverted: ${hash}`)
  return hash
}

// ---------------------------------------------------------------------------------------------
// Reads

export type AgentProfile = {
  agentId: string
  agentRegistry: string
  owner: Address
  wallet: Address | null
  uri: string
  registration: RegistrationFile | null
  reputation: { clients: number; count: number; average: number | null }
}

export async function readAgent(config: Erc8004Config, agentId: bigint, client: PublicClient = readClientFor(config)): Promise<AgentProfile> {
  const [owner, uri, wallet, clients] = await Promise.all([
    client.readContract({ address: config.identityRegistry, abi: identityRegistryAbi, functionName: 'ownerOf', args: [agentId] }),
    client.readContract({ address: config.identityRegistry, abi: identityRegistryAbi, functionName: 'tokenURI', args: [agentId] }),
    client
      .readContract({ address: config.identityRegistry, abi: identityRegistryAbi, functionName: 'getAgentWallet', args: [agentId] })
      .catch(() => null),
    client.readContract({ address: config.reputationRegistry, abi: reputationRegistryAbi, functionName: 'getClients', args: [agentId] }),
  ])
  // Average computed from the individual (non-revoked) feedback values, so it does not depend on how a
  // registry implementation aggregates getSummary().
  let count = 0
  let average: number | null = null
  if (clients.length > 0) {
    const [, , values, decimals] = await client.readContract({
      address: config.reputationRegistry,
      abi: reputationRegistryAbi,
      functionName: 'readAllFeedback',
      args: [agentId, [...clients], '', '', false],
    })
    const scores = values.map((v, i) => Number(v) / 10 ** decimals[i])
    count = scores.length
    average = count > 0 ? scores.reduce((a, b) => a + b, 0) / count : null
  }
  return {
    agentId: agentId.toString(),
    agentRegistry: agentRegistryId(config),
    owner,
    wallet: wallet && wallet !== '0x0000000000000000000000000000000000000000' ? wallet : null,
    uri,
    registration: parseAgentUri(uri),
    reputation: { clients: clients.length, count, average },
  }
}
