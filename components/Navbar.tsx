'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import { useState } from 'react'
import WalletButton from '@/components/WalletButton'

const NAV_LINKS = [
  { href: '/explore/endpoints', label: 'Endpoints' },
  { href: '/explore/agents', label: 'Agents' },
  { href: '/explore/discover', label: 'Discover' },
  { href: '/explore/run', label: 'Run' },
  { href: '/docs', label: 'Docs' },
  { href: '/explore', label: 'Dashboard' },
] as const

function isActive(pathname: string, href: string) {
  if (href === '/explore') return pathname === '/explore'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 md:px-10">
        <Link href="/" className="flex items-center gap-2 font-mono text-sm font-bold tracking-tight">
          <Image src="/logo.webp" alt="" width={24} height={24} className="h-6 w-6" />
          <span>FINALITY</span>
        </Link>

        <nav aria-label="Main" className="ml-auto mr-6 hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => {
            const active = isActive(pathname, link.href)
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={`font-mono text-xs uppercase tracking-wider transition-colors ${
                  active ? 'text-foreground underline underline-offset-4' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {link.label}
              </Link>
            )
          })}
        </nav>

        <div className="flex items-center gap-3">
          <div className="hidden sm:block">
            <WalletButton />
          </div>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center border border-border md:hidden"
            onClick={() => setIsOpen((v) => !v)}
            aria-expanded={isOpen}
            aria-controls="mobile-nav"
            aria-label={isOpen ? 'Close menu' : 'Open menu'}
          >
            {isOpen ? <X className="h-4 w-4" aria-hidden /> : <Menu className="h-4 w-4" aria-hidden />}
          </button>
        </div>
      </div>

      {isOpen && (
        <nav
          id="mobile-nav"
          aria-label="Mobile"
          className="absolute left-0 top-full flex w-full flex-col border-b border-border bg-background px-4 py-2 md:hidden"
        >
          {NAV_LINKS.map((link) => {
            const active = isActive(pathname, link.href)
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsOpen(false)}
                aria-current={active ? 'page' : undefined}
                className={`border-b border-border py-3 font-mono text-sm uppercase tracking-wider last:border-b-0 ${
                  active ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {link.label}
              </Link>
            )
          })}
          <div className="py-4 sm:hidden">
            <WalletButton />
          </div>
        </nav>
      )}
    </header>
  )
}
