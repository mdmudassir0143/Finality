'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import 'swagger-ui-react/swagger-ui.css'

// swagger-ui touches `window` at import time, so keep it client-only.
const SwaggerUI = dynamic(() => import('swagger-ui-react'), {
  ssr: false,
  loading: () => <p className="px-4 py-10 font-mono text-xs uppercase tracking-wider text-muted-foreground">Loading spec…</p>,
})

const PROXY = '/api/x402'

/** The spec advertises the merchant's own origin; route "Try it out" through the same-origin proxy instead. */
function toProxy<R extends { [key: string]: unknown }>(req: R): R {
  if (typeof req.url !== 'string') return req
  try {
    const url = new URL(req.url, window.location.origin)
    if (url.origin !== window.location.origin && url.pathname.startsWith('/v1/')) {
      return { ...req, url: `${PROXY}${url.pathname}${url.search}` }
    }
  } catch {
    // leave the request untouched
  }
  return req
}

export default function SwaggerDocs() {
  return (
    <main className="flex-1 bg-background">
      <div className="border-b border-border px-4 md:px-10">
        <div className="mx-auto max-w-6xl py-10">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">API docs</p>
          <h1 className="mt-3 text-2xl font-bold tracking-tight md:text-3xl">Finality API</h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">
            OpenAPI explorer on Hedera testnet. Unpaid calls return the 402 payment requirements. To sign and pay,
            use{' '}
            <Link href="/explore/run" className="text-foreground underline underline-offset-4">
              Run
            </Link>
            .
          </p>
        </div>
      </div>
      <div className="mx-auto max-w-6xl overflow-x-auto px-0 md:px-6">
        <SwaggerUI
          url={`${PROXY}/v1/openapi.json`}
          requestInterceptor={toProxy}
          deepLinking
          displayRequestDuration
          tryItOutEnabled
          persistAuthorization
        />
      </div>
    </main>
  )
}
