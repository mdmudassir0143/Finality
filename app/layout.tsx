import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { ClientRoot } from '@/components/ClientRoot'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

const SITE = 'https://finality.accuracy.wtf'

const TITLE = 'Finality — Pay-per-request market intelligence'
const DESCRIPTION =
  'Market, intelligence, AI, and Hedera APIs for people and agents. Pay per request over x402 on Hedera testnet with HashPack, MetaMask, or email. No plans, no API keys.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESCRIPTION,
  icons: { icon: '/logo.webp', apple: '/logo.webp' },
  openGraph: {
    siteName: 'Finality',
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
    url: SITE,
    images: [{ url: '/og.png', width: 1280, height: 720, alt: 'Finality pay-per-request APIs on Hedera' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/og.png'],
  },
  keywords: [
    'Finality',
    'pay per request',
    'x402',
    'Hedera',
    'HBAR',
    'USDC',
    'HashPack',
    'MetaMask',
    'market intelligence',
    'autonomous agents',
    'Blocky402',
  ],
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#ffffff',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ClientRoot>{children}</ClientRoot>
      </body>
    </html>
  )
}
