import type { NextRequest } from 'next/server'

export const dynamic='force-dynamic'
const merchant=(process.env.X402_SERVER_URL||'https://finality-x402-backend.onrender.com').replace(/\/$/,'')

/**
 * Hop-by-hop (RFC 9110 §7.6.1) and proxy-local headers. undici's fetch throws on several of these
 * (connection, keep-alive, upgrade, transfer-encoding, expect), which would turn a valid request into a 503.
 */
const HOP_BY_HOP=['connection','keep-alive','proxy-connection','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','expect']
/** Never forward the browser's first-party credentials for this site to the merchant backend. */
const REQUEST_STRIP=[...HOP_BY_HOP,'host','content-length','cookie','authorization']
/** fetch() already decoded the body, so the upstream encoding/length no longer describe it. */
const RESPONSE_STRIP=[...HOP_BY_HOP,'content-encoding','content-length']
const BODYLESS=new Set(['GET','HEAD'])

function stripHeaders(source:Headers,names:string[]){
  const headers=new Headers(source)
  // `Connection: foo, bar` also nominates foo and bar as hop-by-hop.
  for(const token of (source.get('connection')??'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean))headers.delete(token)
  for(const name of names)headers.delete(name)
  return headers
}

async function proxy(request:NextRequest,{params}:{params:Promise<{path:string[]}>}){
  const {path}=await params
  // Segments arrive decoded; re-encode them so the upstream path is exactly what was asked for, and refuse
  // dot-segments rather than letting URL normalisation silently rewrite the target.
  if(!path?.length||path.some(segment=>segment==='.'||segment==='..'))return Response.json({success:false,error:{code:'invalid_path',message:'Invalid merchant path'}},{status:400})
  const upstream=new URL(`${merchant}/${path.map(encodeURIComponent).join('/')}`)
  upstream.search=request.nextUrl.search
  const headers=stripHeaders(request.headers,REQUEST_STRIP)
  try{
    const response=await fetch(upstream,{method:request.method,headers,body:BODYLESS.has(request.method)?undefined:await request.arrayBuffer(),redirect:'manual',signal:AbortSignal.timeout(30_000)})
    const responseHeaders=stripHeaders(response.headers,RESPONSE_STRIP)
    // PAYMENT-REQUIRED / PAYMENT-RESPONSE pass through untouched; make sure the browser can read them even
    // if this route is called cross-origin (same-origin callers do not need it).
    if(!responseHeaders.has('access-control-expose-headers'))responseHeaders.set('access-control-expose-headers','PAYMENT-REQUIRED,PAYMENT-RESPONSE,X-Request-Id')
    return new Response(request.method==='HEAD'?null:response.body,{status:response.status,statusText:response.statusText,headers:responseHeaders})
  }catch(error){
    const timedOut=(error as Error)?.name==='TimeoutError'
    return Response.json({success:false,error:timedOut?{code:'merchant_timeout',message:'The Finality merchant service did not respond in time.',retryable:true}:{code:'merchant_unavailable',message:'The Finality merchant service is not reachable. Start it with npm run dev:merchant.',retryable:true}},{status:timedOut?504:503})
  }
}

export const GET=proxy
export const HEAD=proxy
export const POST=proxy
export const OPTIONS=proxy
