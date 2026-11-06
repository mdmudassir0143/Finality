import { z } from 'zod'
import { HEDERA_MAINNET_USDC, HEDERA_TESTNET_USDC } from '@x402/hedera'

const bool = z.enum(['true', 'false']).default('false').transform(v => v === 'true')
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Hedera account id that receives payments, e.g. 0.0.1234 */
  X402_PAYTO_ADDRESS: z.string().default('0.0.0'),
  X402_FACILITATOR_URL: z.string().url().default('https://api.testnet.blocky402.com'),
  X402_NETWORK: z.enum(['hedera-mainnet', 'hedera-testnet']).default('hedera-testnet'),
  /** Circle USDC HTS token id; defaults from network when empty. */
  X402_USDC_TOKEN_ID: z.string().default(''),
  /** Fixed USD per 1 HBAR used to derive HBAR accepts from catalog $ prices. */
  X402_USD_PER_HBAR: z.coerce.number().positive().default(0.2),
  X402_ALLOWED_ORIGINS: z.string().default('https://finality.accuracy.wtf,http://localhost:3000'),
  X402_SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(4021),
  /**
   * Optional EVM rail (Step 14b): fUSD on Hedera EVM settled by Finality's own facilitator. The extra `accepts`
   * entry appears only when both are set; the native HBAR/USDC rail via X402_FACILITATOR_URL is unaffected.
   */
  X402_EVM_FACILITATOR_URL: z.string().trim().default(''),
  X402_EVM_PAYTO_ADDRESS: z.string().trim().default(''),
  /** Optional fUSD address override (default contracts/deployments/<network>.json). */
  FUSD_ADDRESS: z.string().trim().default(''),
  /** Public base URL used as the discovery/catalog resource identity (no trailing slash). */
  X402_PUBLIC_URL: z.string().default('https://finality-x402-backend.onrender.com'),
  /** Hedera Mirror Node REST base (no trailing slash). */
  MIRROR_NODE_URL: z.string().default(''),
  /** HCS audit topic (finality.audit.v1). Audit logging is off unless all three HCS_* / MERCHANT_* values are set. */
  HCS_AUDIT_TOPIC_ID: z.string().trim().default(''),
  /** Merchant's own operator account that pays for and signs audit messages (never a user key). */
  MERCHANT_OPERATOR_ID: z.string().trim().default(''),
  MERCHANT_OPERATOR_KEY: z.string().trim().default(''),
  /** ERC-8004 agentId of this merchant in the Identity Registry on Hedera EVM (set after npm run erc8004:register). */
  ERC8004_MERCHANT_AGENT_ID: z.string().trim().regex(/^\d*$/).default(''),
  /** Optional overrides; defaults are the canonical ERC-8004 registries on Hedera testnet. */
  ERC8004_IDENTITY_REGISTRY: z.string().trim().default(''),
  ERC8004_REPUTATION_REGISTRY: z.string().trim().default(''),
  /** Hedera JSON-RPC relay; defaults to Hashio for the configured network. */
  EVM_RPC_URL: z.string().trim().default(''),
  DATA_MODE: z.enum(['live', 'mock', 'auto']).default('live'),
  ALLOW_MOCK_FALLBACK: bool,
  ENABLE_DUMMY_ENDPOINT: bool,
  /** Optional CoinGecko Demo API key (x-cg-demo-api-key). Public endpoints work without it. */
  COINGECKO_API_KEY: z.string().default(''),
  /** Optional CoinGecko Pro API key (x-cg-pro-api-key) for onchain token_price / coins/list. */
  COINGECKO_PRO_API_KEY: z.string().default(''),
  LLM_PROVIDER: z.enum(['ollama', 'groq', 'huggingface', 'gemini']).default('ollama'),
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_API_KEY: z.string().default(''), OLLAMA_MODEL: z.string().default('qwen3:8b'),
  GROQ_API_KEY: z.string().default(''), GROQ_MODEL: z.string().default(''),
  /** Google AI Studio / Gemini API key (OpenAI-compatible endpoint). */
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
})

export type Env = z.infer<typeof schema>

export function defaultUsdcForNetwork(network: Env['X402_NETWORK']): string {
  return network === 'hedera-testnet' ? HEDERA_TESTNET_USDC : HEDERA_MAINNET_USDC
}

export function defaultMirrorForNetwork(network: Env['X402_NETWORK']): string {
  return network === 'hedera-testnet'
    ? 'https://testnet.mirrornode.hedera.com'
    : 'https://mainnet-public.mirrornode.hedera.com'
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const env = schema.parse(source)
  if (!env.X402_USDC_TOKEN_ID) {
    ;(env as { X402_USDC_TOKEN_ID: string }).X402_USDC_TOKEN_ID = defaultUsdcForNetwork(env.X402_NETWORK)
  }
  if (!env.MIRROR_NODE_URL) {
    ;(env as { MIRROR_NODE_URL: string }).MIRROR_NODE_URL = defaultMirrorForNetwork(env.X402_NETWORK)
  }
  if (env.NODE_ENV === 'production' && env.DATA_MODE === 'mock') throw new Error('Production rejects DATA_MODE=mock')
  if (env.NODE_ENV === 'production' && env.ENABLE_DUMMY_ENDPOINT) throw new Error('Production rejects ENABLE_DUMMY_ENDPOINT=true')
  return env
}
