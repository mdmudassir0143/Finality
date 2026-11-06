/** @type {import('next').NextConfig} */

const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control',   value: 'on' },
  { key: 'X-Frame-Options',          value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options',   value: 'nosniff' },
  { key: 'Referrer-Policy',          value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      // Reown AppKit (wallet modal) fonts and WalletConnect verify/secure frames; Magic's embedded-wallet iframe.
      "font-src 'self' data: https://fonts.reown.com",
      "frame-src 'self' https://verify.walletconnect.com https://verify.walletconnect.org https://secure.walletconnect.com https://secure.walletconnect.org https://auth.magic.link",
      "connect-src 'self' https: wss:",
      "frame-ancestors 'none'",
    ].join('; '),
  },
]

const nextConfig = {
  transpilePackages: ['@hiero-ledger/sdk', '@hashgraph/hedera-wallet-connect'],
  turbopack: { root: __dirname },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.binance.com' },
      { protocol: 'https', hostname: 'bin.bnbstatic.com' },
      { protocol: 'https', hostname: 's2.coinmarketcap.com' },
      { protocol: 'https', hostname: 'assets.coingecko.com' },
    ],
  },
}

module.exports = nextConfig
