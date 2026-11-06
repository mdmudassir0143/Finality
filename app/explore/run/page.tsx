'use client'

import { Suspense } from 'react'
import RunClient from './RunClient'

export default function Page() {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">Loading run workspace…</div>}>
      <RunClient />
    </Suspense>
  )
}
