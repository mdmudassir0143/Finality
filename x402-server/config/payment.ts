import {
  HBAR_ASSET_ID,
  HEDERA_MAINNET_CAIP2,
  HEDERA_MAINNET_USDC,
  HEDERA_TESTNET_CAIP2,
  HEDERA_TESTNET_USDC,
  HEDERA_USDC_DECIMALS,
} from '@x402/hedera'
import type { Env } from './env'
import { fusdConfig, usdToFusdUnits } from '../../lib/evm/fusd'

export {
  HBAR_ASSET_ID,
  HEDERA_MAINNET_CAIP2,
  HEDERA_MAINNET_USDC,
  HEDERA_TESTNET_CAIP2,
  HEDERA_TESTNET_USDC,
  HEDERA_USDC_DECIMALS,
}

export const MAINNET_USDC_TOKEN_ID = HEDERA_MAINNET_USDC
export const TESTNET_USDC_TOKEN_ID = HEDERA_TESTNET_USDC

/** Tinybars per HBAR. */
export const TINYBARS_PER_HBAR = 100_000_000n

export function caip2ForNetwork(network: string): typeof HEDERA_MAINNET_CAIP2 | typeof HEDERA_TESTNET_CAIP2 {
  if (network === 'hedera-testnet' || network === HEDERA_TESTNET_CAIP2 || network.includes('testnet')) {
    return HEDERA_TESTNET_CAIP2
  }
  return HEDERA_MAINNET_CAIP2
}

export function usdcTokenIdForNetwork(network: string, override?: string): string {
  if (override) return override
  return caip2ForNetwork(network) === HEDERA_TESTNET_CAIP2 ? HEDERA_TESTNET_USDC : HEDERA_MAINNET_USDC
}

/** Parse catalog price like `$0.15` into a decimal USD number. */
export function usdFromPrice(price: string): number {
  return Number(String(price).replace(/[^0-9.]/g, '')) || 0
}

/** Parse a non-negative decimal string into an integer scaled by 10^decimals (no floating point). */
export function decimalToScaled(value: string, decimals: number): bigint {
  const clean = String(value).replace(/[^0-9.]/g, '')
  const [whole = '0', fraction = ''] = clean.split('.')
  const scale = 10n ** BigInt(decimals)
  return BigInt(whole || '0') * scale + BigInt((fraction.slice(0, decimals) || '0').padEnd(decimals, '0'))
}

/**
 * Convert a USD catalog price to tinybars at a fixed USD/HBAR rate, with integer math only
 * (Hedera x402 amounts are tinybars; floats must not decide what a payer is charged).
 * Example: $0.15 at 0.20 USD/HBAR → 75_000_000 tinybars (0.75 HBAR). Rounds half up, minimum 1 tinybar.
 */
export function tinybarsFromUsd(price: string, usdPerHbar: number): string {
  const usdE8 = decimalToScaled(price, 8)
  const rateE8 = decimalToScaled((usdPerHbar > 0 ? usdPerHbar : 0.2).toFixed(8), 8)
  const tinybars = (usdE8 * TINYBARS_PER_HBAR * 2n + rateE8) / (rateE8 * 2n)
  return (tinybars > 0n ? tinybars : 1n).toString()
}

/** Placeholder account id used when no treasury is configured. Never a real payTo. */
export const PLACEHOLDER_PAYTO = '0.0.0'

/** Merchant treasury comes from env only (`X402_PAYTO_ADDRESS`). */
export function resolvePayTo(env: Env): string {
  return env.X402_PAYTO_ADDRESS.trim()
}

export function isPayToConfigured(payTo: string): boolean {
  return Boolean(payTo) && payTo !== PLACEHOLDER_PAYTO
}

/** EVM rail: fUSD (EIP-3009) on Hedera EVM, settled by Finality's own facilitator. */
export type EvmRail = {
  network: `eip155:${number}`
  asset: `0x${string}`
  payTo: string
  facilitator: string
  name: string
  version: string
  symbol: string
  decimals: number
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/

/** The EVM rail when X402_EVM_FACILITATOR_URL and X402_EVM_PAYTO_ADDRESS are set and fUSD is deployed; else null. */
export function evmRail(env: Env): EvmRail | null {
  if (!env.X402_EVM_FACILITATOR_URL || !EVM_ADDRESS.test(env.X402_EVM_PAYTO_ADDRESS)) return null
  const fusd = fusdConfig(env.X402_NETWORK, env.FUSD_ADDRESS)
  if (!fusd) return null
  return {
    network: fusd.network,
    asset: fusd.address,
    payTo: env.X402_EVM_PAYTO_ADDRESS,
    facilitator: env.X402_EVM_FACILITATOR_URL.replace(/\/$/, ''),
    name: fusd.name,
    version: fusd.version,
    symbol: fusd.symbol,
    decimals: fusd.decimals,
  }
}

export function paymentAccepts(env: Env, price: string, payTo: string, network: string) {
  const rail = evmRail(env)
  return [
    ...nativeAccepts(env, price, payTo, network),
    ...(rail
      ? [
          {
            scheme: 'exact' as const,
            // AssetAmount form; `name`/`version` are the token's EIP-712 domain, which the payer signs over.
            price: {
              amount: usdToFusdUnits(price, rail.decimals),
              asset: rail.asset,
              extra: { name: rail.name, version: rail.version, decimals: rail.decimals, symbol: rail.symbol },
            },
            network: rail.network,
            payTo: rail.payTo,
            extra: { name: rail.name, version: rail.version, decimals: rail.decimals, symbol: rail.symbol },
          },
        ]
      : []),
  ]
}

function nativeAccepts(env: Env, price: string, payTo: string, network: string) {
  return [
    {
      scheme: 'exact' as const,
      price,
      network,
      payTo,
      extra: { decimals: HEDERA_USDC_DECIMALS, symbol: 'USDC' },
    },
    {
      scheme: 'exact' as const,
      // AssetAmount form — ExactHederaScheme rejects Money→HBAR via defaultAssets (HTS only).
      price: {
        amount: tinybarsFromUsd(price, env.X402_USD_PER_HBAR),
        asset: HBAR_ASSET_ID,
        extra: { decimals: 8, symbol: 'HBAR' },
      },
      network,
      payTo,
      extra: { decimals: 8, symbol: 'HBAR' },
    },
  ]
}

export const hederaDefaultAssets = (env: Env) => {
  const usdc = usdcTokenIdForNetwork(env.X402_NETWORK, env.X402_USDC_TOKEN_ID)
  return {
    [HEDERA_TESTNET_CAIP2]: { asset: usdc, decimals: HEDERA_USDC_DECIMALS },
    [HEDERA_MAINNET_CAIP2]: { asset: usdc, decimals: HEDERA_USDC_DECIMALS },
  }
}
