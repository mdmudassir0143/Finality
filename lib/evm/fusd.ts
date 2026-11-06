/**
 * Finality USD (fUSD): the EIP-3009 test dollar on Hedera EVM used for x402 payments signed by EVM wallets
 * (MetaMask). Deployed by `npm run fusd:deploy`; the address lives in contracts/deployments/<network>.json.
 *
 * This is additive to the native Hedera rail (HBAR / HTS USDC via Blocky402), which it never touches.
 */
import testnetDeployment from '../../contracts/deployments/hedera-testnet.json'

export type FusdConfig = {
  /** CAIP-2 network of the Hedera EVM chain: eip155:296 (testnet) or eip155:295 (mainnet). */
  network: `eip155:${number}`
  chainId: number
  address: `0x${string}`
  /** EIP-712 domain name and version; x402 sends these as `extra.name` / `extra.version`. */
  name: string
  version: string
  symbol: string
  decimals: number
}

const deployments: Record<string, typeof testnetDeployment | undefined> = {
  'hedera-testnet': testnetDeployment,
}

/** fUSD for a Hedera network label (`hedera-testnet` / `hedera-mainnet`), or null when it is not deployed there. */
export function fusdConfig(hederaNetwork: string, overrideAddress?: string): FusdConfig | null {
  const d = deployments[hederaNetwork]
  const address = (overrideAddress?.trim() || d?.fusd.address) as `0x${string}` | undefined
  if (!address) return null
  const chainId = hederaNetwork === 'hedera-mainnet' ? 295 : 296
  return {
    network: `eip155:${chainId}`,
    chainId,
    address,
    name: d?.fusd.name ?? 'Finality USD',
    version: d?.fusd.version ?? '1',
    symbol: d?.fusd.symbol ?? 'fUSD',
    decimals: d?.fusd.decimals ?? 6,
  }
}

/** USD price string ("$0.15" or "0.15") → fUSD base units (6 decimals), exact decimal arithmetic. */
export function usdToFusdUnits(price: string | number, decimals = 6): string {
  const text = String(price).replace(/^\$/, '').trim()
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`Invalid USD price: ${price}`)
  const [whole, frac = ''] = text.split('.')
  if (frac.length > decimals && /[1-9]/.test(frac.slice(decimals))) throw new Error(`Price ${price} exceeds ${decimals} decimals`)
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0')
  return units.toString()
}
