import { HBAR_ASSET_ID, HEDERA_TESTNET_USDC, HEDERA_MAINNET_USDC } from '@x402/hedera'

export const HEDERA_NETWORK =
  (process.env.NEXT_PUBLIC_HEDERA_NETWORK as 'hedera-testnet' | 'hedera-mainnet') || 'hedera-testnet'

export const HEDERA_CAIP2 = HEDERA_NETWORK === 'hedera-mainnet' ? 'hedera:mainnet' : 'hedera:testnet'

export const USDC_TOKEN_ID =
  process.env.NEXT_PUBLIC_USDC_TOKEN_ID ||
  (HEDERA_NETWORK === 'hedera-mainnet' ? HEDERA_MAINNET_USDC : HEDERA_TESTNET_USDC)

export const MIRROR_NODE_URL =
  process.env.NEXT_PUBLIC_MIRROR_NODE_URL ||
  (HEDERA_NETWORK === 'hedera-mainnet'
    ? 'https://mainnet-public.mirrornode.hedera.com'
    : 'https://testnet.mirrornode.hedera.com')

export const WALLETCONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'finality-hedera-dev-placeholder'

export { HBAR_ASSET_ID }
