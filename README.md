# Finality

Market data and intelligence you pay for per request, built for both people and autonomous agents. Every paid call settles on Hedera through [x402](https://www.x402.org): the API answers `402 Payment Required`, the caller signs a payment, and the data comes back once it settles.

- **App:** [finality.accuracy.wtf](https://finality.accuracy.wtf)
- **API:** [finality-x402-backend.onrender.com](https://finality-x402-backend.onrender.com)
- **Network:** Hedera testnet

## What's in here

| Path | What it is |
| --- | --- |
| `app/`, `components/` | Next.js client: landing page, explorer, endpoint runner, audit and transaction views, agents page, API docs |
| `x402-server/` | Hono merchant API, the canonical public service. Paid routes, discovery, audit and ERC-8004 lookups |
| `facilitator/` | Finality's own x402 facilitator for Hedera EVM (fUSD, EIP-3009). It pays gas for the merchant payee only |
| `contracts/` | `FinalityUSD.sol` (fUSD) with its compile script and testnet deployment |
| `agent/` | Rule-based research agent: discovers the catalog, plans, pays under a spend policy, and rates the merchant |
| `agents/` | LLM agents on Hedera Agent Kit + Vercel AI SDK + Gemini, plus a benchmark harness |
| `keeper/` | Standalone traffic keeper: funds a fleet of wallets and makes random paid calls |
| `lib/` | Code shared by the client and server: Hedera, EVM, x402 helpers, provider adapters |
| `scripts/` | Wallet setup, deploys, HCS topic creation, ERC-8004 registration, smoke tests |
| `docs/` | Status report, settlements, agent runs, benchmarks, build trackers |

## How a paid call works

1. Call a paid route without payment. You get HTTP 402 and a `Payment-Required` header listing the accepted assets: **USDC (HTS)**, **HBAR**, and **fUSD** on Hedera EVM if the EVM facilitator is configured.
2. Build and partially sign a Hedera `TransferTransaction`, with the facilitator as fee payer.
3. Retry the request with the `Payment-Signature` header.
4. The facilitator verifies and settles: [Blocky402](https://blocky402.com) for HBAR/USDC, Finality's own facilitator for fUSD.
5. Only then does Finality call the data provider and return the response.

In the browser, users connect with **HashPack** (WalletConnect), a **Magic** email wallet, or **MetaMask** on Hedera EVM (chain 296). Agents bring their own Hedera signer. The app never sees a private key.

## Endpoints

Free:

| Route | Purpose |
| --- | --- |
| `GET /health` | Component health and configured modes |
| `GET /info` | Service info, payment rails, discovery links |
| `GET /v1/catalog` | Prices, limits, examples and operation IDs, readable by agents |
| `GET /v1/openapi.json` | OpenAPI 3.1 document |
| `GET /.well-known/x402`, `/.well-known/agent.json`, `/llms.txt` | Discovery documents for agents |
| `GET /v1/audit/recent` | Recent entries from the HCS audit topic |
| `GET /v1/erc8004/merchant`, `/v1/erc8004/agents/:id` | ERC-8004 identity and reputation |

Paid:

- **Market:** `/v1/market/quotes`, `assets`, `candles`, `trending`, `categories`, `fear-greed`, `token-prices`
- **Analysis:** `/v1/technicals`, `/v1/signals`, `/v1/backtest`, `/v1/analysis/report`, `volume`, `events`
- **Agent tools:** `/v1/agent/briefing`, `/v1/agent/decision`, `/v1/agent/strategy/parse`, `/v1/ai/chat`
- **Hedera on-chain** (Mirror Node): `/v1/onchain/hedera/account`, `balances`, `token`, `transaction`, `topic`, `blocks`, `network/supply`, `network/nodes`

The full list with prices is at `/v1/catalog`, or at `/docs` in the app.

## On-chain pieces

- **HCS audit trail:** the merchant logs each sale and the agent logs each spend to one Hedera Consensus Service topic, and both record the same hash of the response. You can view it at `/explore/audit`.
- **ERC-8004 identities:** Finality and the research agent are registered in the shared ERC-8004 registries on Hedera EVM. After each purchase, the agent leaves on-chain feedback for the merchant.
- **fUSD:** a test dollar (EIP-3009) at `0x8Bb1d3aa637A54859dcC772EB01fE45eEECE482f` on Hedera testnet. It lets MetaMask users pay over x402.
- **HCS-11 agent profile:** the intelligence agent has its own account and an HCS-11 profile.

## Getting started

You need Node.js 20+, a Hedera testnet account to receive payments, and a WalletConnect project ID.

```bash
npm install
cp .env.example .env
```

At minimum, set `X402_PAYTO_ADDRESS` and `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`. Every variable is documented in [`.env.example`](.env.example). One `.env` file covers the merchant, the scripts and the frontend, and `x402-server/.env` can override merchant values.

```bash
npm run dev:merchant     # x402 API on :4021
npm run dev:frontend     # Next.js on :3000
npm run dev:all          # both
npm run dev:facilitator  # optional EVM facilitator on :4022 (needs FACILITATOR_EVM_KEY)
```

Optional extras:

```bash
npm run hcs:create-audit-topic        # create the audit topic, then set HCS_AUDIT_TOPIC_ID
npm run erc8004:register -- merchant  # register the merchant identity (or `-- agent`)
npm run fusd:compile && npm run fusd:deploy
```

## Agents

```bash
npm run agent                                          # rule-based research agent
npm run agents -- list
npm run agents -- run intelligence --goal "How is HBAR doing today?"
npm run agents -- bench intelligence                   # writes docs/BENCHMARKS.md
```

Both agents share one spend policy: a total budget, per-call and per-merchant limits, a payee allowlist, and human approval above a threshold. A paid call that breaks the policy never gets paid. Recorded runs are in [`docs/AGENT_RUNS.md`](docs/AGENT_RUNS.md).

The keeper has its own setup. See [`keeper/README.md`](keeper/README.md).

## Tests

```bash
npm run test:x402          # merchant, middleware and agent tests
npm run test:wallet:e2e    # wallet end-to-end
npm run test:x402:testnet  # real paid call on testnet (needs X402_TEST_PAYER_*)
npm run test:x402:evm      # real fUSD paid call
npx tsc --noEmit
```

## Deploying

The merchant API runs on Render. Build it with `npm run build:x402` and start it with `npm run start:x402`. The keeper's Render service is defined in `render.yaml`. The frontend is on Vercel (`vercel.json`).

## Security

- The merchant never stores a private key or a raw signed payment.
- The server warns on startup if `X402_PAYTO_ADDRESS` is unset or still the `0.0.0` placeholder.
- Inputs, body size, request rate, concurrency and provider timeouts are all limited.
- On-chain responses report Mirror Node data only, with no invented metrics. If a market or AI provider fails, the response falls back to sample data that is labelled as synthetic.
