/** Create a Hedera ECDSA keypair for smoke tests / agent payers. */
import { PrivateKey } from '@hiero-ledger/sdk'
import { writeFileSync } from 'node:fs'

const privateKey = PrivateKey.generateECDSA()
const publicKey = privateKey.publicKey
const wallet = {
  network: 'hedera-testnet',
  privateKey: privateKey.toStringDer(),
  publicKey: publicKey.toStringDer(),
  evmAddress: publicKey.toEvmAddress(),
  note: 'Provision a Hedera account for this key, then set X402_TEST_PAYER_ACCOUNT_ID + X402_TEST_PAYER_PRIVATE_KEY.',
  createdAt: new Date().toISOString(),
}
writeFileSync('test-wallet.json', JSON.stringify(wallet, null, 2))
console.log(JSON.stringify(wallet, null, 2))
