import type { SpendControls } from '@x402/core/client'
import { HBAR_ASSET_ID } from '@x402/hedera'

/** Must cover the highest catalog price (ai.chat $4.00). The @x402 default is $1. */
export const MAX_USD_PER_PAYMENT = '$5'

/**
 * HBAR cap per payment in tinybars: 25 HBAR, i.e. $5 at the merchant's default 0.20 USD/HBAR rate.
 * HBAR (0.0.0) is not an x402 "default asset" on Hedera (only USDC is), so without an explicit
 * allowedAssets entry the client silently drops every HBAR payment option.
 */
export const MAX_TINYBARS_PER_PAYMENT = '2500000000'

/** fUSD cap per payment in base units (6 decimals): $5, matching MAX_USD_PER_PAYMENT. */
export const MAX_FUSD_UNITS_PER_PAYMENT = '5000000'

/**
 * Spend controls for Finality's rails. HBAR and (when `fusd` is given) the fUSD test dollar on Hedera EVM are not x402
 * "default assets", so each needs an explicit allowedAssets entry with its own atomic cap.
 */
export function hederaSpendControls(
  opts: { maxUsd?: string; maxTinybars?: string; fusd?: { network: string; address: string }; maxFusdUnits?: string } = {},
): SpendControls {
  return {
    maxAmountPerPayment: (opts.maxUsd ?? MAX_USD_PER_PAYMENT) as SpendControls['maxAmountPerPayment'],
    allowedAssets: [
      { network: 'hedera:*', asset: HBAR_ASSET_ID, maxAmountPerPayment: opts.maxTinybars ?? MAX_TINYBARS_PER_PAYMENT },
      ...(opts.fusd
        ? [{ network: opts.fusd.network as `${string}:${string}`, asset: opts.fusd.address, maxAmountPerPayment: opts.maxFusdUnits ?? MAX_FUSD_UNITS_PER_PAYMENT }]
        : []),
    ],
  }
}
