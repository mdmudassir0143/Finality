'use client'

import { HederaWalletProvider } from '@/lib/hedera/wallet'

export default function Providers({ children }: { children: React.ReactNode }) {
  return <HederaWalletProvider>{children}</HederaWalletProvider>
}
