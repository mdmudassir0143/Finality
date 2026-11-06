import { PrivateKey } from '@hiero-ledger/sdk'

/**
 * Parse a Hedera private key from DER or hex. Portal exports for x402 payers are usually ECDSA,
 * so ECDSA is tried first, then the generic DER parser, then ED25519.
 */
export function parseHederaPrivateKey(raw: string): PrivateKey {
  const value = raw.trim()
  if (!value) throw new Error('Empty Hedera private key')
  const attempts: Array<() => PrivateKey> = [
    () => PrivateKey.fromStringECDSA(value),
    () => PrivateKey.fromString(value),
    () => PrivateKey.fromStringED25519(value),
  ]
  let lastError: unknown
  for (const attempt of attempts) {
    try {
      return attempt()
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`Unrecognized Hedera private key format: ${String(lastError)}`)
}
