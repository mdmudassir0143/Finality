import { describe, expect, it } from 'vitest'
import { executeOperation } from '../../services/operation'
import { loadEnv } from '../../config/env'

const autoEnv = loadEnv({
  NODE_ENV: 'test',
  DATA_MODE: 'auto',
  ALLOW_MOCK_FALLBACK: 'true',
  ENABLE_DUMMY_ENDPOINT: 'false',
  X402_PAYTO_ADDRESS: '0.0.1001',
  X402_FACILITATOR_URL: 'https://api.testnet.blocky402.com',
  X402_NETWORK: 'hedera-testnet',
  X402_USDC_TOKEN_ID: '0.0.429274',
  X402_ALLOWED_ORIGINS: 'http://localhost:3000',
  X402_SERVER_PORT: '4021',
  MIRROR_NODE_URL: 'https://mirror.invalid.example',
  LLM_PROVIDER: 'ollama',
  OLLAMA_BASE_URL: 'http://localhost:11434',
})

const mockEnv = loadEnv({
  NODE_ENV: 'test',
  DATA_MODE: 'mock',
  ALLOW_MOCK_FALLBACK: 'true',
  ENABLE_DUMMY_ENDPOINT: 'false',
  X402_PAYTO_ADDRESS: '0.0.1001',
  X402_FACILITATOR_URL: 'https://api.testnet.blocky402.com',
  X402_NETWORK: 'hedera-testnet',
  X402_USDC_TOKEN_ID: '0.0.429274',
  X402_ALLOWED_ORIGINS: 'http://localhost:3000',
  X402_SERVER_PORT: '4021',
  MIRROR_NODE_URL: 'https://testnet.mirrornode.hedera.com',
  LLM_PROVIDER: 'ollama',
  OLLAMA_BASE_URL: 'http://localhost:11434',
})

describe('provider fallback', () => {
  it('returns labeled mock for hedera token when mirror is unreachable in auto mode', async () => {
    const result = await executeOperation(autoEnv, 'onchain.hederaToken', { tokenId: '0.0.429274' })
    expect(result.meta.synthetic).toBe(true)
  })

  it('returns mock fixture when DATA_MODE=mock', async () => {
    const result = await executeOperation(mockEnv, 'onchain.hederaAccount', { accountId: '0.0.1001' })
    expect(result.meta.dataMode).toBe('mock')
  })
})
