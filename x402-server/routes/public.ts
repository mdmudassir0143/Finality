import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Hono } from 'hono'
import type { Env } from '../config/env'
import { catalog, openapi } from '../registry/catalog'
import { endpoints } from '../registry/endpoints'
import { HBAR_ASSET_ID, evmRail, isPayToConfigured, resolvePayTo } from '../config/payment'
import { isAuditConfigured } from '../audit/sale'
import {
  PLATFORM,
  agentsMd,
  agentCard,
  agentManifest,
  discoveryContext,
  aiPlugin,
  brandingHtml,
  llmsTxt,
  LOGO_SVG,
  OG_SVG,
  publicOrigin,
  wellKnownX402,
} from '../discovery/platform'

/** Resolve brand assets without import.meta (Render tsc emits CommonJS). */
function resolveAssetsDir(): string {
  const candidates = [
    join(process.cwd(), 'x402-server', 'public'),
    join(process.cwd(), 'public'),
  ]
  for (const dir of candidates) {
    if (existsSync(join(dir, 'logo.webp')) || existsSync(join(dir, 'og.png'))) return dir
  }
  return candidates[0]
}

const assetsDir = resolveAssetsDir()

function readAsset(name: string): Buffer | null {
  const path = join(assetsDir, name)
  if (!existsSync(path)) return null
  return readFileSync(path)
}

function wantsHtml(accept: string | undefined): boolean {
  if (!accept) return true
  const a = accept.toLowerCase()
  if (a.includes('application/json') && !a.includes('text/html')) return false
  return a.includes('text/html') || a.includes('*/*') || a.includes('text/*')
}

export function registerPublicRoutes(app: Hono, env: Env) {
  const origin = publicOrigin(env.X402_PUBLIC_URL)
  const payTo = resolvePayTo(env)
  const ctx = discoveryContext(env, origin)

  // Discovery scrapers hit `/` for og:* / title / icons — serve HTML to crawlers, JSON to API clients.
  app.get('/', c => {
    if (wantsHtml(c.req.header('accept'))) {
      return c.html(brandingHtml(ctx))
    }
    return c.json({
      service: PLATFORM.name,
      version: '1.0.0',
      website: PLATFORM.website,
      merchantId: PLATFORM.merchantId,
      payTo,
      logo: `${PLATFORM.website}${PLATFORM.logoPath}`,
      image: `${PLATFORM.website}${PLATFORM.ogPath}`,
      catalog: '/v1/catalog',
      openapi: '/v1/openapi.json',
      wellKnown: {
        x402: '/.well-known/x402',
        agentCard: '/.well-known/agent-card.json',
        agent: '/.well-known/agent.json',
        aiPlugin: '/.well-known/ai-plugin.json',
      },
      llms: '/llms.txt',
      agents: '/agents.md',
    })
  })

  app.get('/logo.webp', c => {
    const file = readAsset('logo.webp')
    if (!file) return c.body(LOGO_SVG, 200, { 'content-type': 'image/svg+xml; charset=utf-8' })
    return c.body(new Uint8Array(file), 200, {
      'content-type': 'image/webp',
      'cache-control': 'public, max-age=86400',
    })
  })
  app.get('/og.png', c => {
    const file = readAsset('og.png')
    if (!file) return c.body(OG_SVG, 200, { 'content-type': 'image/svg+xml; charset=utf-8' })
    return c.body(new Uint8Array(file), 200, {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=86400',
    })
  })
  // Back-compat redirects for older scrapers / bookmarks
  app.get('/logo.svg', c => c.redirect(PLATFORM.logoPath, 302))
  app.get('/og.svg', c => c.redirect(PLATFORM.ogPath, 302))
  app.get('/favicon.ico', c => c.redirect(PLATFORM.logoPath, 302))

  app.get('/.well-known/x402', c =>
    c.json(wellKnownX402(ctx)),
  )
  app.get('/.well-known/agent-card.json', c => c.json(agentCard(ctx)))
  app.get('/.well-known/agent.json', c => c.json(agentManifest(ctx)))
  app.get('/.well-known/ai-plugin.json', c => c.json(aiPlugin(ctx)))
  app.get('/llms.txt', c => c.text(llmsTxt(ctx), 200, { 'content-type': 'text/plain; charset=utf-8' }))
  app.get('/agents.md', c => c.text(agentsMd(ctx), 200, { 'content-type': 'text/markdown; charset=utf-8' }))

  // Static configuration report (no upstream probes). `ai` is only "configured" for a keyed backend: the Ollama
  // URL always has a localhost default, so it is reported as unverified rather than claimed as working.
  const rail = evmRail(env)
  const keyedAi = env.GEMINI_API_KEY ? 'gemini' : env.GROQ_API_KEY && env.GROQ_MODEL ? 'groq' : null
  app.get('/health', c => c.json({ status:isPayToConfigured(payTo)?'ok':'degraded', service: PLATFORM.name, version:'1.0.0', uptimeSeconds:process.uptime(), merchantId: PLATFORM.merchantId, components:{ x402:{status:isPayToConfigured(payTo)?'configured':'misconfigured',facilitator:'Blocky402',network:ctx.networkLabel}, evmRail:rail?{status:'configured',network:rail.network,asset:rail.asset}:{status:'disabled'}, marketProviders:{status:'configured',mode:env.DATA_MODE}, mirrorNode:{status:'configured',url:env.MIRROR_NODE_URL}, hcsAudit:isAuditConfigured(env)?{status:'configured',topicId:env.HCS_AUDIT_TOPIC_ID}:{status:'disabled'}, ai:keyedAi?{status:'configured',provider:keyedAi}:{status:env.LLM_PROVIDER==='ollama'?'unverified':'disabled',provider:env.LLM_PROVIDER,fallback:'deterministic'} } }))
  app.get('/info', c => c.json({
    service: PLATFORM.name,
    version: '1.0.0',
    website: PLATFORM.website,
    merchantId: PLATFORM.merchantId,
    network: ctx.networkLabel,
    paymentAssets: [
      { symbol: 'USDC', tokenId: ctx.usdcTokenId },
      { symbol: 'HBAR', assetId: HBAR_ASSET_ID },
    ],
    facilitator: 'Blocky402',
    logo: `${PLATFORM.website}${PLATFORM.logoPath}`,
    image: `${PLATFORM.website}${PLATFORM.ogPath}`,
    endpoints: endpoints.length,
    catalog: '/v1/catalog',
    openapi: '/v1/openapi.json',
    discovery: {
      wellKnownX402: '/.well-known/x402',
      agentCard: '/.well-known/agent-card.json',
      agent: '/.well-known/agent.json',
      aiPlugin: '/.well-known/ai-plugin.json',
      llms: '/llms.txt',
      agents: '/agents.md',
    },
  }))

  app.get('/v1/catalog', c => c.json({ success:true, data: catalog() }))
  app.get('/v1/openapi.json', c => c.json(openapi(origin)))
}
