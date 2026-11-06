import Image from 'next/image'
import Link from 'next/link'
import { FACILITATOR } from '@/lib/facilitator'

const PRODUCT = [
  { href: '/explore', label: 'Dashboard' },
  { href: '/explore/endpoints', label: 'Endpoints' },
  { href: '/explore/run', label: 'Run' },
  { href: '/explore/transactions', label: 'Transactions' },
  { href: '/explore/audit', label: 'Audit' },
  { href: '/docs', label: 'API docs' },
] as const

const RESOURCES = [
  { href: FACILITATOR.docs, label: 'Blocky402 docs' },
  { href: FACILITATOR.facilitator, label: 'Facilitator' },
  { href: FACILITATOR.hashscanTestnet, label: 'HashScan testnet' },
] as const

const heading = 'mb-4 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground'
const linkClass = 'text-sm text-muted-foreground transition-colors hover:text-foreground'

export function Footer() {
  return (
    <footer className="mt-auto border-t border-border bg-background">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-10 px-4 py-12 md:grid-cols-4 md:px-10">
        <div className="col-span-2 space-y-3">
          <Link href="/" className="inline-flex items-center gap-2 font-mono text-sm font-bold tracking-tight">
            <Image src="/logo.webp" alt="" width={20} height={20} className="h-5 w-5" />
            <span>FINALITY</span>
          </Link>
          <p className="max-w-xs text-sm text-muted-foreground">Pay-per-request market intelligence on Hedera.</p>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Hedera testnet · HashPack · MetaMask · Email
          </p>
        </div>

        <nav aria-label="Product">
          <p className={heading}>Product</p>
          <ul className="space-y-2">
            {PRODUCT.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className={linkClass}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Resources">
          <p className={heading}>Resources</p>
          <ul className="space-y-2">
            {RESOURCES.map((item) => (
              <li key={item.href}>
                <a href={item.href} target="_blank" rel="noopener noreferrer" className={linkClass}>
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  )
}
