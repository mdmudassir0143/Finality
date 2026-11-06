# Finality API endpoints

All paid prices are catalogued in USD and settle as **USDC (HTS)** or equivalent **HBAR** on Hedera via x402 / Blocky402.

An unsigned request returns HTTP `402` with dual `accepts` (USDC + HBAR). Clients sign a partially signed Hedera `TransferTransaction` and retry with the payment payload. Successful responses include `PAYMENT-RESPONSE`.

## Market / intelligence / agents / AI

See live catalog: [`/v1/catalog`](https://finality-x402-backend.onrender.com/v1/catalog) or OpenAPI [`/v1/openapi.json`](https://finality-x402-backend.onrender.com/v1/openapi.json).

Pro routes (Intelligence, Agent tools, AI) are Gemini-backed at roughly $1.00–$4.00.

## Hedera on-chain (Mirror Node)

| operationId | Method | Path | Price | Purpose |
|---|---|---|---:|---|
| `onchain.hederaAccount` | POST | `/v1/onchain/hedera/account` | $0.25 | Account info |
| `onchain.hederaBalances` | POST | `/v1/onchain/hedera/balances` | $0.35 | HBAR + HTS holdings |
| `onchain.hederaToken` | POST | `/v1/onchain/hedera/token` | $0.20 | Token metadata |
| `onchain.hederaTransaction` | POST | `/v1/onchain/hedera/transaction` | $0.25 | Transaction detail |
| `onchain.hederaTopic` | POST | `/v1/onchain/hedera/topic` | $0.30 | HCS messages |
| `onchain.hederaNetworkSupply` | GET | `/v1/onchain/hedera/network/supply` | $0.10 | Network supply |
| `onchain.hederaNetworkNodes` | GET | `/v1/onchain/hedera/network/nodes` | $0.15 | Node snapshot |
| `onchain.hederaBlocks` | GET | `/v1/onchain/hedera/blocks` | $0.20 | Recent blocks |

Reads use the public Mirror Node (`MIRROR_NODE_URL`). No invented liquidity metrics.

## Audit trail (free, read-only)

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/audit/recent?limit=25` | Decoded `finality.audit.v1` records from the merchant's HCS audit topic, newest first, with HashScan links to each HCS record and each x402 payment |

After Blocky402 settles a payment, the merchant writes a `sale` record: the operation, payer, payTo,
asset, amount, payment transaction ID and the SHA-256 of the exact response bytes delivered. Buying agents
write `spend` records with their policy decision and remaining budget. The feed returns
`enabled: false` until `HCS_AUDIT_TOPIC_ID`, `MERCHANT_OPERATOR_ID` and `MERCHANT_OPERATOR_KEY` are set.
The UI lives at `/explore/audit`.

## Agent identity: ERC-8004 on Hedera EVM (free, read-only)

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/erc8004/merchant` | This merchant's ERC-8004 identity: owner, on-chain registration file, reputation |
| GET | `/v1/erc8004/agents/:agentId` | Any agent in the registry |

Finality uses the canonical ERC-8004 registries on Hedera testnet (chain 296, through Hashio):
- IdentityRegistry `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- ReputationRegistry `0x8004B663056A597Dffe9eCcC1965A193B7388713`

Registration files are stored on-chain as `data:` URIs, and identities are created with
`npm run erc8004:register -- merchant|agent`. One ECDSA key controls both the Hedera account (`0.0.x`, which
pays x402) and its EVM alias (`0x…`, which owns the ERC-8004 identity).

## Clients

- Browser: HashPack on Hedera testnet via the Explore UI
- Agents: `@x402/hedera` + `createClientHederaSigner` (see `scripts/testnet-paid-smoke.ts`)

## Testnet funding

Payers need **HBAR** (and **USDC** `0.0.429274` if paying in USDC, after token association). The Blocky402 facilitator pays network fees as `feePayer` — the user does not need extra HBAR solely for gas on the payment tx, but still needs the settlement asset balance.
