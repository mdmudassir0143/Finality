# Settled x402 payments on Hedera

Evidence of real x402 payments settled through Blocky402. Each row is written by
`npm run test:x402:testnet` (`scripts/testnet-paid-smoke.ts`) after the Mirror Node confirms the transaction.

## EVM rail: fUSD on Hedera EVM via Finality's own facilitator (Step 14b)

The payer only signs EIP-712 (`TransferWithAuthorization`); the Finality facilitator (`facilitator/`, gas wallet
`0xAABf…D97B` = `0.0.11334505`) submits it and pays gas. fUSD `0x8Bb1d3aa637A54859dcC772EB01fE45eEECE482f` is an
EIP-3009 test dollar, not Circle USDC. Payee: treasury EVM alias `0x153cc53c83394e6971b26d900d08fef7ae9568e8`
(`0.0.11331489`).

| Date (UTC) | Network | Asset | Amount | Route | Payer | Transaction | HCS sale | How |
|---|---|---|---|---|---|---|---|---|
| 2026-11-06 04:56 | eip155:296 | fUSD | 0.15 | `/v1/market/quotes` | `0x7Ff7…8938` (agent) | [`0x6e0eaaf7…b4cc`](https://hashscan.io/testnet/transaction/0x6e0eaaf7d4f0af9315609eec339bf94be4040503e08f5302db77fd3c4911b4cc) | #28 | `@x402/fetch` + key signer |
| 2026-11-06 05:10 | eip155:296 | fUSD | 0.15 | `/v1/market/quotes` | `0x9ae2…5b30` (MetaMask) | [`0xec334210…a6d4`](https://hashscan.io/testnet/transaction/0xec334210150b117df6b92badcc90f383209c32ddda350bd8d4142ae4dd5fa6d4) | #29 | Browser Run page, real MetaMask |
| 2026-11-06 05:15 | eip155:296 | fUSD | 0.15 | `/v1/market/quotes` | `0x7Ff7…8938` (agent) | [`0x00395c9e…065c`](https://hashscan.io/testnet/transaction/0x00395c9ef475ba7e6ac3273ad0c5716743d00c377872e6c821326718d4ff065c) | #31 | `npm run test:x402:evm` (injected EIP-1193) |

## Native rail: HBAR / USDC via Blocky402

| Date (UTC) | Network | Asset | Amount | Route | Payer | Transaction ID | Result | HashScan |
|---|---|---|---|---|---|---|---|---|
| 2026-11-05 23:44:59 | Hedera testnet | HBAR | 0.5 HBAR (50000000 tinybars) | `/v1/onchain/hedera/network/supply` | 0.0.11331261 | `0.0.7162784@1793922288.636099269` | SUCCESS | [view](https://hashscan.io/testnet/transaction/1793922295.281634310) |
| 2026-11-05 23:55:17 | Hedera testnet | USDC | 0.1 USDC | `/v1/onchain/hedera/network/supply` | 0.0.11331261 | `0.0.7162784@1793922904.693328440` | SUCCESS | [view](https://hashscan.io/testnet/transaction/1793922913.887443776) |
