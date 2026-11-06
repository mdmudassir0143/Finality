'use client'

import Providers from '@/components/Providers'
import { LayoutShell } from '@/components/LayoutShell'
import type { ReactNode } from 'react'

export function ClientRoot({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <LayoutShell>{children}</LayoutShell>
    </Providers>
  )
}
