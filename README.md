# Finality Market Intelligence

Finality is a market-intelligence resource server for humans and autonomous agents. Its canonical public API is the standalone Hono service in `x402-server/`. Paid requests settle **HBAR** or **USDC (HTS)** on Hedera through x402 and are verified/settled by the [Blocky402](https://blocky402.com) facilitator.

The Next.js application is a client of this service. Browser users connect **HashPack** via Hedera WalletConnect. Agents supply their own Hedera signer. The app never receives a private key.

## Merchant quick start

Requirements: Node.js 20+, a Hedera testnet merchant account (`X402_PAYTO_ADDRESS`), and a WalletConnect project id for the frontend.

```bash
npm install
mkdir -p x402-server
cp .env.example .env
```

Set `X402_PAYTO_ADDRESS` and `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, then:

```bash
npm run dev:merchant
npm run dev:frontend
```

Or both: `npm run dev:all`.

Production client: [https://finality.accuracy.wtf](https://finality.accuracy.wtf). Merchant API default: [https://finality-x402-backend.onrender.com](https://finality-x402-backend.onrender.com).

## Public discovery

| Free route | Purpose |
| --- | --- |
| `GET /health` | Component health and configured modes |
| `GET /info` | Service, payment rail, and discovery links |
| `GET /v1/catalog` | Agent-readable prices, limits, examples, and operation IDs |
| `GET /v1/openapi.json` | OpenAPI 3.1 document |

## Payment contract

1. Call a paid route without payment → HTTP 402 + `Payment-Required` (accepts **USDC** and **HBAR**).
2. Build and partially sign a Hedera `TransferTransaction` (facilitator is `feePayer`).
3. Retry with `Payment-Signature` / payment payload.
4. Blocky402 verifies and settles (pays network fees).
5. Only then does Finality call a provider and return the response.

## Catalog highlights

- Market data, intelligence, agent tools, AI analyst (unchanged product logic)
- Hedera Mirror Node reads: account, balances, token, transaction, topic, network supply/nodes, blocks

## Environment

See [`.env.example`](.env.example). Key vars: `X402_PAYTO_ADDRESS`, `X402_FACILITATOR_URL` (Blocky402), `X402_NETWORK`, `X402_USDC_TOKEN_ID`, `MIRROR_NODE_URL`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`.

```bash
npm run build:x402
npm run test:x402
npx tsc --noEmit
```

## Security rules

- The merchant stores no private key or raw signed payment payload.
- Blocky402 is the facilitator; live mode fails closed when misconfigured.
- Inputs, body size, rate, concurrency, and provider timeouts are bounded.
- Hedera on-chain output reports Mirror Node data only — no invented liquidity metrics.
