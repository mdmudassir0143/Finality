import { loadEnv } from '../config/env'
export const testEnv = loadEnv({
  NODE_ENV: 'test',
  DATA_MODE: 'mock',
  ALLOW_MOCK_FALLBACK: 'false',
  ENABLE_DUMMY_ENDPOINT: 'true',
  X402_PAYTO_ADDRESS: '0.0.1001',
  X402_FACILITATOR_URL: 'https://api.testnet.blocky402.com',
  X402_NETWORK: 'hedera-testnet',
  X402_USDC_TOKEN_ID: '0.0.429274',
  X402_USD_PER_HBAR: '0.2',
  X402_ALLOWED_ORIGINS: 'http://localhost:3000',
  X402_SERVER_PORT: '4021',
  MIRROR_NODE_URL: 'https://testnet.mirrornode.hedera.com',
  LLM_PROVIDER: 'ollama',
  OLLAMA_BASE_URL: 'http://localhost:11434',
  OLLAMA_MODEL: 'qwen3:8b',
})
