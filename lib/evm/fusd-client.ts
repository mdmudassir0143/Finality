import { createPublicClient, erc20Abi, formatUnits, http, type WalletClient } from 'viem'
import { hedera, hederaTestnet } from 'viem/chains'
import { toClientEvmSigner, type ClientEvmSigner } from '@x402/evm'
import type { FusdConfig } from './fusd'

/**
 * x402 EVM signer over a connected EIP-1193 wallet (MetaMask). The wallet only signs EIP-712 typed data
 * (eth_signTypedData_v4); it never sends a transaction, so the payer needs no HBAR for x402 payments.
 */
export function evmSignerFromWallet(wallet: WalletClient): ClientEvmSigner {
  const account = wallet.account
  if (!account) throw new Error('EVM wallet has no account')
  return toClientEvmSigner({
    address: account.address,
    signTypedData: (message) =>
      wallet.signTypedData({ account, ...(message as Omit<Parameters<WalletClient['signTypedData']>[0], 'account'>) }),
  })
}

/** fUSD balance of an EVM address as a decimal string (e.g. "99.85"), read from Hedera EVM. */
export async function readFusdBalance(fusd: FusdConfig, address: `0x${string}`): Promise<string> {
  const client = createPublicClient({ chain: fusd.chainId === 295 ? hedera : hederaTestnet, transport: http() })
  const units = await client.readContract({ address: fusd.address, abi: erc20Abi, functionName: 'balanceOf', args: [address] })
  return formatUnits(units, fusd.decimals)
}
