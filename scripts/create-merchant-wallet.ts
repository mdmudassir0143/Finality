/**
 * Create a Hedera ECDSA account keypair for use as X402_PAYTO_ADDRESS.
 * Fund the account on Hedera testnet / mainnet separately (portal faucet or transfer).
 */
import { PrivateKey } from '@hiero-ledger/sdk'
import { writeFileSync } from 'node:fs'

const privateKey = PrivateKey.generateECDSA()
const publicKey = privateKey.publicKey
const wallet = {
  network: 'hedera-testnet',
  purpose: 'Dedicated Finality x402 merchant receiver',
  privateKey: privateKey.toStringDer(),
  publicKey: publicKey.toStringDer(),
  evmAddress: publicKey.toEvmAddress(),
  note: 'Create the account on Hedera with this public key (or import private key into HashPack), then set X402_PAYTO_ADDRESS to the resulting 0.0.x account id.',
  createdAt: new Date().toISOString(),
}
writeFileSync('merchant-wallet.json', JSON.stringify(wallet, null, 2))
console.log(JSON.stringify(wallet, null, 2))
console.log('Wrote merchant-wallet.json — do not commit this file.')
