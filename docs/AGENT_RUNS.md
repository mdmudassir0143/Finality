# Autonomous agent runs on Hedera testnet

Each section below is written by `npm run agent -- … --record`. The research agent (ERC-8004 #145, Hedera
`0.0.11331261`) discovers Finality through `/.well-known/x402`, verifies the merchant's ERC-8004 identity
(#144) on Hedera EVM, and plans calls for its goal. Every call is checked against its spending policy. It then
pays through x402 (Blocky402) with no human approval below the threshold, writes an HCS `spend` record and leaves
ERC-8004 feedback whose `feedbackHash` is the SHA-256 of the delivered data. The merchant's own HCS `sale`
record for the same payment carries the same hash.

## 2026-11-05T23:55:59.643Z — "HBAR market + network health brief"

Merchant http://localhost:4021 (ERC-8004 #144, verified). Spent $0.5, budget left $0.5. Audit topic [0.0.11331606](https://hashscan.io/testnet/topic/0.0.11331606).

| Operation | USD | Decision | Reason | Payment | ERC-8004 feedback |
|---|---|---|---|---|---|
| `market.fearGreed` | 0.1 | paid | within policy | [0.0.7162784@1793922919.298495668](https://hashscan.io/testnet/transaction/0.0.7162784-1793922919-298495668) | [tx](https://hashscan.io/testnet/transaction/0x32834d4a6c0218ad0b6b60868b313a8ace2b6b9922ea06ccfa29ab7e26e9aa08) |
| `onchain.hederaNetworkSupply` | 0.1 | paid | within policy | [0.0.7162784@1793922927.608304730](https://hashscan.io/testnet/transaction/0.0.7162784-1793922927-608304730) | [tx](https://hashscan.io/testnet/transaction/0x7300c75a9c0602510eba4f53e1f060e7a167a434bff59b9cb7c18298bc9e6a2c) |
| `market.quotes` | 0.15 | paid | within policy | [0.0.7162784@1793922935.490102438](https://hashscan.io/testnet/transaction/0.0.7162784-1793922935-490102438) | [tx](https://hashscan.io/testnet/transaction/0x16d68fbe88a1e7e1ca5ba3695564bb98fce77fed972e7fa2b40c79821c540e88) |
| `onchain.hederaNetworkNodes` | 0.15 | paid | within policy | [0.0.7162784@1793922948.093194785](https://hashscan.io/testnet/transaction/0.0.7162784-1793922948-093194785) | [tx](https://hashscan.io/testnet/transaction/0x58809290b427add49cc2a0449d1946db54a71c3994fcf35587b3a84e6be586b4) |

## 2026-11-06T07:47:54.001Z — Finality Intelligence Analyst: "What is HBAR's current USD price and how healthy is the Hedera network right now?"

gemini-3.5-flash, 6 steps, 46154 tokens, 37.2 s, spent $0.30 of $0.5.

| Source | Tool | Args | Payment |
|---|---|---|---|
| — | `finality_catalog_tool` | `{}` | — |
| S1 | `get_exchange_rate_tool` | `{}` | — |
| — | `finality_budget_tool` | `{}` | — |
| S2 | `finality_call_tool` | `{"operationId":"market.quotes","input":"{\"symbols\":[\"HBAR\"]}"}` | $0.15 paid [tx](https://hashscan.io/testnet/transaction/0.0.7162784-1793951279-132934558) |
| S3 | `finality_call_tool` | `{"operationId":"onchain.hederaNetworkNodes","input":"{}"}` | $0.15 paid [tx](https://hashscan.io/testnet/transaction/0.0.7162784-1793951286-789458203) |

> ## Answer
> HBAR is currently trading at a spot market price of $0.068049 USD [S2], while the Hedera network's on-chain HBAR exchange rate is recorded at $0.068378 USD [S1]. The Hedera public distributed ledger shows healthy node operation, with multiple active consensus nodes actively participating in staking and reward distribution [S3]. HBAR has recorded a 24-hour price movement of -6.38% alongside a 24-hour volume of $73,774,399 [S2].
> 
> ## Findings
> - HBAR spot market price is $0.068049 USD with a market capitalization of $3,016,409,895 [S2].
> - Hedera network on-chain HBAR exchange rate is set at $0.068378 USD per HBAR [S1].
> - HBAR 24-hour trading volume is $73,774,399, with a 24-hour price change of -6.38% and a 7-day change of -4.01% [S2].
> - Consensus nodes across regional host facilities are active with defined staking periods and reward rates [S3].
> 
> ## Caveats
> - None
