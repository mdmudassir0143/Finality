import type { Metadata } from 'next'
import SwaggerDocs from '@/components/SwaggerDocs'

export const metadata: Metadata = {
  title: 'API docs · Finality',
  description: 'OpenAPI reference for the Finality x402 API on Hedera testnet.',
}

export default function ApiDocsPage() {
  return <SwaggerDocs />
}
