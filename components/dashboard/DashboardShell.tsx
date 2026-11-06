'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity,
  Bot,
  Compass,
  LayoutGrid,
  Link2,
  PlusCircle,
  Settings,
  ShieldCheck,
  Terminal,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import WalletButton from '@/components/WalletButton'

const TABS: { href: string; label: string; icon: typeof LayoutGrid; exact?: boolean }[] = [
  { href: '/explore', label: 'overview', icon: LayoutGrid, exact: true },
  { href: '/explore/transactions', label: 'transactions', icon: Activity },
  { href: '/explore/audit', label: 'audit', icon: ShieldCheck },
  { href: '/explore/run', label: 'run', icon: PlusCircle },
  { href: '/explore/endpoints', label: 'endpoints', icon: Link2 },
  { href: '/explore/agents', label: 'agents', icon: Bot },
  { href: '/explore/discover', label: 'discover', icon: Compass },
  { href: '/explore/settings', label: 'settings', icon: Settings },
]

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="min-h-screen bg-background text-foreground font-mono">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 md:px-6 h-12 flex items-center justify-between gap-4">
          <Link href="/explore" className="flex shrink-0 items-center gap-2 text-sm font-bold tracking-tight">
            <Terminal className="h-4 w-4" />
            <span>{'>_'} DASHBOARD</span>
          </Link>
          {/* The wallet chip shows the connection state itself (status dot + account), so no separate status text. */}
          <WalletButton />
        </div>

        <nav className="max-w-6xl mx-auto px-4 md:px-6 flex items-center gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const active = tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(tab.href + '/')
            const Icon = tab.icon
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'inline-flex items-center gap-2 px-3 py-2.5 text-xs lowercase tracking-wide border-b-2 -mb-px transition-colors whitespace-nowrap',
                  active
                    ? 'border-foreground text-foreground font-semibold'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </Link>
            )
          })}
          <Link
            href="/"
            className="ml-auto hidden md:inline text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground py-2.5"
          >
            ← ./home
          </Link>
        </nav>
      </header>

      <div className="max-w-6xl mx-auto px-4 md:px-6 py-8 md:py-10">{children}</div>
    </div>
  )
}
