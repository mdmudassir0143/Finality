import { endpoints } from '../registry/endpoints'
import { usdToFusdUnits } from '../../lib/evm/fusd'
import type { Env } from '../config/env'
import { isAuditConfigured } from '../audit/sale'
import { erc8004Discovery } from '../erc8004/config'
import {
  HBAR_ASSET_ID,
  HEDERA_TESTNET_CAIP2,
  caip2ForNetwork,
  evmRail,
  resolvePayTo,
  type EvmRail,
  tinybarsFromUsd,
  usdFromPrice,
  usdcTokenIdForNetwork,
} from '../config/payment'

/** Platform identity for discovery scrapers and well-known docs. */
export const PLATFORM = {
  name: 'Finality Market Intelligence',
  shortName: 'Finality',
  description:
    'Agent- and user-accessible market, AI, and Hedera on-chain intelligence — paid per result with HBAR or USDC via x402.',
  website: 'https://finality.accuracy.wtf',
  apiBase: 'https://finality-x402-backend.onrender.com',
  logoPath: '/logo.webp',
  ogPath: '/og.png',
  themeColor: '#0B0E11',
  merchantId: 'finality-hedera',
} as const

export const DISCOVERY_TAGS = [
  'finality',
  'x402',
  'hedera',
  'hbar',
  'usdc',
] as const

/** Network-dependent values every discovery document is rendered from. */
export type DiscoveryCtx = {
  origin: string
  payTo: string
  caip2: string
  network: 'hedera-testnet' | 'hedera-mainnet'
  networkLabel: 'Hedera testnet' | 'Hedera mainnet'
  usdcTokenId: string
  hbarAsset: string
  facilitator: string
  usdPerHbar: number
  /** HCS audit topic id when the audit trail is configured. */
  auditTopicId: string | null
  /** ERC-8004 identity of this merchant on Hedera EVM, when registered. */
  erc8004: ReturnType<typeof erc8004Discovery>
  /** Optional EVM rail (fUSD on Hedera EVM via Finality's own facilitator), when configured. */
  evm: EvmRail | null
}

export function discoveryContext(env: Env, origin: string): DiscoveryCtx {
  const caip2 = caip2ForNetwork(env.X402_NETWORK)
  const testnet = caip2 === HEDERA_TESTNET_CAIP2
  return {
    origin,
    payTo: resolvePayTo(env),
    caip2,
    network: testnet ? 'hedera-testnet' : 'hedera-mainnet',
    networkLabel: testnet ? 'Hedera testnet' : 'Hedera mainnet',
    usdcTokenId: usdcTokenIdForNetwork(env.X402_NETWORK, env.X402_USDC_TOKEN_ID),
    hbarAsset: HBAR_ASSET_ID,
    facilitator: env.X402_FACILITATOR_URL,
    usdPerHbar: env.X402_USD_PER_HBAR,
    auditTopicId: isAuditConfigured(env) ? env.HCS_AUDIT_TOPIC_ID : null,
    erc8004: erc8004Discovery(env),
    evm: evmRail(env),
  }
}

/** Discovery block for the optional EVM rail. fUSD is a test token, not Circle USDC. */
function evmDiscovery(rail: EvmRail) {
  return {
    network: rail.network,
    scheme: 'exact',
    assetTransferMethod: 'eip3009',
    asset: rail.asset,
    symbol: rail.symbol,
    decimals: rail.decimals,
    eip712: { name: rail.name, version: rail.version },
    payTo: rail.payTo,
    facilitator: rail.facilitator,
    note: 'fUSD is a test dollar for EVM wallets (MetaMask); Circle USDC stays on the native Hedera rail.',
  }
}

export function publicOrigin(envPublicUrl?: string): string {
  const base = (envPublicUrl || PLATFORM.apiBase).replace(/\/$/, '')
  return base || PLATFORM.apiBase
}

export function brandingHtml(ctx: DiscoveryCtx): string {
  const { origin, payTo } = ctx
  const logo = `${PLATFORM.website}${PLATFORM.logoPath}`
  const og = `${PLATFORM.website}${PLATFORM.ogPath}`
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${PLATFORM.name}</title>
  <meta name="description" content="${PLATFORM.description}" />
  <meta name="keywords" content="${[...DISCOVERY_TAGS, 'Blocky402', 'x402'].join(', ')}" />
  <meta name="theme-color" content="${PLATFORM.themeColor}" />

  <meta property="og:site_name" content="${PLATFORM.shortName}" />
  <meta property="og:title" content="${PLATFORM.name}" />
  <meta property="og:description" content="${PLATFORM.description}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${origin}/" />
  <meta property="og:image" content="${og}" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${PLATFORM.name}" />
  <meta name="twitter:description" content="${PLATFORM.description}" />
  <meta name="twitter:image" content="${og}" />

  <link rel="icon" type="image/webp" href="${logo}" />
  <link rel="apple-touch-icon" href="${logo}" />
  <link rel="canonical" href="${PLATFORM.website}" />
</head>
<body>
  <main>
    <p><img src="${logo}" alt="${PLATFORM.shortName}" width="96" height="96" /></p>
    <h1>${PLATFORM.name}</h1>
    <p>${PLATFORM.description}</p>
    <ul>
      <li>Website: <a href="${PLATFORM.website}">${PLATFORM.website}</a></li>
      <li>Catalog: <a href="${origin}/v1/catalog">${origin}/v1/catalog</a></li>
      <li>OpenAPI: <a href="${origin}/v1/openapi.json">${origin}/v1/openapi.json</a></li>
      <li>Merchant ID: ${PLATFORM.merchantId}</li>
      <li>PayTo: ${payTo}</li>
    </ul>
  </main>
</body>
</html>`
}

export function wellKnownX402(ctx: DiscoveryCtx) {
  const { origin, payTo, usdcTokenId } = ctx
  return {
    x402Version: 2,
    name: PLATFORM.name,
    description: PLATFORM.description,
    website: PLATFORM.website,
    logo: `${PLATFORM.website}${PLATFORM.logoPath}`,
    image: `${PLATFORM.website}${PLATFORM.ogPath}`,
    merchantId: PLATFORM.merchantId,
    network: ctx.caip2,
    facilitator: ctx.facilitator,
    ...(ctx.auditTopicId ? { audit: { protocol: 'hcs', schema: 'finality.audit.v1', topicId: ctx.auditTopicId, feed: `${origin}/v1/audit/recent` } } : {}),
    ...(ctx.erc8004 ? { identity: ctx.erc8004 } : {}),
    ...(ctx.evm ? { evm: evmDiscovery(ctx.evm) } : {}),
    tags: [...DISCOVERY_TAGS],
    categories: ['market-intelligence', 'agents', 'hedera', 'x402'],
    resources: endpoints.flatMap(endpoint => {
      const usdAmount = String(Math.round(usdFromPrice(endpoint.price) * 1e6))
      const base = {
        url: `${origin}${endpoint.path}`,
        method: endpoint.method,
        description: `${endpoint.description} — ${endpoint.price} (USDC or HBAR)`,
        network: ctx.caip2,
        payTo,
        tags: [...DISCOVERY_TAGS, endpoint.availabilityTrack],
      }
      return [
        { ...base, asset: usdcTokenId, amount: usdAmount },
        { ...base, asset: ctx.hbarAsset, amount: tinybarsFromUsd(endpoint.price, ctx.usdPerHbar) },
        ...(ctx.evm
          ? [{ ...base, network: ctx.evm.network, payTo: ctx.evm.payTo, asset: ctx.evm.asset, amount: usdToFusdUnits(endpoint.price, ctx.evm.decimals) }]
          : []),
      ]
    }),
  }
}

export function agentCard(ctx: DiscoveryCtx) {
  const { origin } = ctx
  return {
    name: PLATFORM.name,
    description: PLATFORM.description,
    url: origin,
    documentation: `${origin}/llms.txt`,
    version: '1.0.0',
    capabilities: { streaming: false },
    defaultInputModes: ['text', 'application/json'],
    defaultOutputModes: ['application/json'],
    ...(ctx.erc8004 ? { registrations: [{ agentId: ctx.erc8004.agentId, agentRegistry: ctx.erc8004.agentRegistry }] } : {}),
    tags: [...DISCOVERY_TAGS],
    skills: endpoints.map(endpoint => ({
      id: endpoint.operationId,
      name: endpoint.operationId,
      description: `${endpoint.description} (${endpoint.price} via x402 HBAR or USDC)`,
      tags: [...DISCOVERY_TAGS, endpoint.availabilityTrack],
    })),
  }
}

export function agentManifest(ctx: DiscoveryCtx) {
  const { origin, payTo } = ctx
  return {
    name: PLATFORM.name,
    description: PLATFORM.description,
    url: origin,
    website: PLATFORM.website,
    logo: `${PLATFORM.website}${PLATFORM.logoPath}`,
    image: `${PLATFORM.website}${PLATFORM.ogPath}`,
    documentation: `${origin}/llms.txt`,
    tags: [...DISCOVERY_TAGS],
    categories: ['market-intelligence', 'agents', 'hedera', 'x402'],
    ...(ctx.erc8004 ? { identity: ctx.erc8004 } : {}),
    payments: {
      protocol: 'x402',
      network: ctx.network,
      caip2: ctx.caip2,
      assets: ['USDC', 'HBAR'],
      usdcTokenId: ctx.usdcTokenId,
      hbarAsset: ctx.hbarAsset,
      facilitator: ctx.facilitator,
      ...(ctx.auditTopicId ? { auditTopicId: ctx.auditTopicId } : {}),
      merchantId: PLATFORM.merchantId,
      payTo,
      ...(ctx.evm ? { evm: evmDiscovery(ctx.evm) } : {}),
    },
  }
}

export function aiPlugin(ctx: DiscoveryCtx) {
  const { origin } = ctx
  return {
    schema_version: 'v1',
    name_for_human: PLATFORM.name,
    name_for_model: 'finality_market_intelligence',
    description_for_human: PLATFORM.description,
    description_for_model:
      'Call Finality Market Intelligence paid endpoints. Unsigned requests return HTTP 402 with x402 payment requirements; retry with PAYMENT-SIGNATURE after settling HBAR or USDC on Hedera.',
    api: { type: 'openapi', url: `${origin}/v1/openapi.json` },
    logo_url: `${PLATFORM.website}${PLATFORM.logoPath}`,
    contact_email: 'hello@finality.app',
  }
}

export function llmsTxt(ctx: DiscoveryCtx): string {
  const { origin, payTo } = ctx
  const lines = [
    `# ${PLATFORM.name}`,
    '',
    `> ${PLATFORM.description}`,
    '>',
    '> Every paid route answers HTTP 402 with x402 payment requirements. Pay HBAR or USDC on Hedera, retry with PAYMENT-SIGNATURE.',
    '',
    '## Platform',
    `- Website: ${PLATFORM.website}`,
    `- API: ${origin}`,
    `- Merchant ID: ${PLATFORM.merchantId}`,
    `- PayTo: ${payTo}`,
    `- Facilitator: ${ctx.facilitator}`,
    `- Network: ${ctx.networkLabel} (${ctx.caip2}) · Assets: USDC (${ctx.usdcTokenId}) and HBAR (${ctx.hbarAsset})`,
    ...(ctx.auditTopicId ? [`- Audit log: HCS topic ${ctx.auditTopicId} (finality.audit.v1), feed ${origin}/v1/audit/recent`] : []),
    ...(ctx.evm ? [`- EVM rail: ${ctx.evm.symbol} (${ctx.evm.asset}, EIP-3009 test dollar) on ${ctx.evm.network} via ${ctx.evm.facilitator}, payTo ${ctx.evm.payTo}`] : []),
    ...(ctx.erc8004 ? [`- Identity: ERC-8004 agent #${ctx.erc8004.agentId} in ${ctx.erc8004.agentRegistry} (reputation ${ctx.erc8004.reputationRegistry}), lookup ${origin}/v1/erc8004/merchant`] : []),
    `- Tags: ${DISCOVERY_TAGS.join(', ')}`,
    '',
    '## Paid endpoints',
    ...endpoints.map(
      e => `- [${e.operationId}](${origin}${e.path}): ${e.method} — ${e.description}. ${e.price} (USDC or HBAR).`,
    ),
    '',
    '## Docs',
    `- [Catalog](${origin}/v1/catalog)`,
    `- [OpenAPI](${origin}/v1/openapi.json)`,
    `- [Info](${origin}/info)`,
    '',
  ]
  return lines.join('\n')
}

export function agentsMd(ctx: DiscoveryCtx): string {
  const { origin, payTo } = ctx
  return `# ${PLATFORM.name}

Instructions for agents working with this service.

## Payment
Every product endpoint is x402-paid. On HTTP 402, decode the PAYMENT-REQUIRED header (base64 JSON), pay the advertised requirement in HBAR or USDC on ${ctx.networkLabel} via ${ctx.facilitator}, then retry with the PAYMENT-SIGNATURE header.

## Identity
- Merchant ID: ${PLATFORM.merchantId}
- PayTo: ${payTo}
- Website: ${PLATFORM.website}
- API origin: ${origin}

## Discovery
- Catalog: ${origin}/v1/catalog
- OpenAPI: ${origin}/v1/openapi.json
- Well-known: ${origin}/.well-known/x402

## Notes
- Prices are advertised in the 402; never hardcode amounts.
- Prefer durable market/on-chain routes when provider quotas matter.
`
}

/** Fallback SVG mark if binary assets are unavailable at runtime */
export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="Finality">
  <rect width="512" height="512" fill="#0B0E11"/>
  <path fill="#E8EEF5" d="M168 96h210l-48 72H240v72h112l-40 64H240v112h-72V96z"/>
</svg>`

export const OG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="Finality Market Intelligence">
  <rect width="1200" height="630" fill="#0B0E11"/>
  <text x="80" y="280" fill="#E8EEF5" font-family="system-ui,sans-serif" font-size="72" font-weight="700">Finality</text>
  <text x="80" y="350" fill="#8B97A8" font-family="system-ui,sans-serif" font-size="32">Market Intelligence</text>
  <polyline fill="none" stroke="#5B9FD4" stroke-width="3" points="640,420 720,380 780,400 860,300 940,320 1020,220 1100,240"/>
</svg>`
