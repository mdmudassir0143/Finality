import { x402Client } from '@x402/core/client'
import { wrapFetchWithPayment } from '@x402/fetch'
import { ExactHederaScheme } from '@x402/hedera/exact/client'
import { createClientHederaSigner } from '@x402/hedera'
import { hederaCaip2, loadConfig } from './config.js'
import { parsePrivateKey } from './hedera.js'
import type { KeeperWallet } from './types.js'
import { buildRequest, type PaidEndpoint } from './endpoints.js'

const PRO_PREFIXES = ['intelligence.', 'agent.', 'ai.']

/** Must cover highest catalog price (ai.chat $4.00). @x402 default is $1. */
const MAX_AMOUNT_PER_PAYMENT = '$5'

export function isProEndpoint(operationId: string): boolean {
  return PRO_PREFIXES.some((p) => operationId.startsWith(p))
}

/**
 * Paid call. Receipt is true only when the merchant returns PAYMENT-RESPONSE
 * (real USDC/HBAR settlement). Mock AI answers happen on the merchant after settle —
 * the keeper must not invent receipt=true without that header.
 */
export async function callPaidEndpoint(
  baseUrl: string,
  wallet: KeeperWallet,
  endpoint: PaidEndpoint,
): Promise<{
  status: number
  operationId: string
  usdcPrice: number
  receipt: boolean
  error?: string
}> {
  if (!wallet.accountId) {
    throw new Error(`Wallet #${wallet.index} has no Hedera accountId`)
  }

  const config = loadConfig()
  const network = hederaCaip2(config.X402_NETWORK)
  const privateKey = parsePrivateKey(wallet.privateKey)
  const signer = createClientHederaSigner(wallet.accountId, privateKey, { network })
  const client = x402Client.fromConfig({
    schemes: [{ network, client: new ExactHederaScheme(signer) }],
    spendControls: { maxAmountPerPayment: MAX_AMOUNT_PER_PAYMENT },
  })
  const paidFetch = wrapFetchWithPayment(fetch, client)
  const { urlPath, init, usdcPrice } = buildRequest(endpoint, wallet.accountId)

  const response = await paidFetch(`${baseUrl.replace(/\/$/, '')}${urlPath}`, init)
  const body = (await response.json().catch(() => ({}))) as {
    success?: boolean
    operationId?: string
    data?: unknown
    error?: { message?: string }
    message?: string
  }
  const receipt = Boolean(
    response.headers.get('payment-response') || response.headers.get('PAYMENT-RESPONSE'),
  )

  if (response.ok && body?.success !== false) {
    return {
      status: response.status,
      operationId: body.operationId ?? endpoint.operationId,
      usdcPrice,
      receipt,
    }
  }

  return {
    status: response.status,
    operationId: endpoint.operationId,
    usdcPrice,
    receipt,
    error: body?.error?.message || body?.message || `HTTP ${response.status}`,
  }
}
