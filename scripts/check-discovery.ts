/**
 * Probe merchant discovery surfaces and Blocky402 /supported.
 *
 * Usage:
 *   npm run check:discovery
 */
const facilitator = (process.env.X402_FACILITATOR_URL || 'https://api.testnet.blocky402.com').replace(/\/$/, '')
const payTo = process.env.X402_PAYTO_ADDRESS || ''
const merchantBase = (process.env.X402_PUBLIC_URL || process.env.X402_SMOKE_URL || 'https://finality-x402-backend.onrender.com').replace(/\/$/, '')

async function getJson(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  const text = await response.text()
  try {
    return { status: response.status, body: JSON.parse(text) as any }
  } catch {
    return { status: response.status, body: { raw: text.slice(0, 200) } }
  }
}

async function main() {
  console.log(JSON.stringify({ payTo, merchantBase, facilitator }, null, 2))

  const supported = await getJson(`${facilitator}/supported`)
  console.log(JSON.stringify({ step: 'facilitator_supported', status: supported.status, body: supported.body }, null, 2))

  const catalog = await getJson(`${merchantBase}/v1/catalog`)
  console.log(JSON.stringify({
    step: 'catalog',
    status: catalog.status,
    count: Array.isArray(catalog.body?.data) ? catalog.body.data.length : undefined,
  }, null, 2))

  const probe = await fetch(`${merchantBase}/v1/market/fear-greed?limit=1`)
  const paymentRequired = probe.headers.get('payment-required') || probe.headers.get('PAYMENT-REQUIRED')
  if (paymentRequired) {
    const decoded = JSON.parse(Buffer.from(paymentRequired, 'base64').toString('utf8'))
    const assets = (decoded.accepts ?? []).map((a: any) => a.asset)
    console.log(JSON.stringify({
      step: '402_probe',
      status: probe.status,
      assets,
      resource: decoded?.resource?.url,
    }, null, 2))
  } else {
    console.log(JSON.stringify({ step: '402_probe', status: probe.status, note: 'no payment-required header' }, null, 2))
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
