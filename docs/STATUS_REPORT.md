# Finality: status report for `hedera-feature-1`

This branch is 26 commits ahead of `hedera` (194 files changed), all pushed to `origin/hedera-feature-1`. The automated tests pass (110 x402 tests plus the wallet end-to-end test), and the production build is clean.

## What changed from `hedera`

**Bugs fixed that had stopped real payments**
- Payments were being sent to the placeholder account `0.0.0` instead of the real treasury.
- On-chain transaction lookups failed: the code sent IDs to the Hedera data service (Mirror Node) in a format it rejects.
- Choosing HBAR as the payment asset was silently ignored.
- Scripts read the test accounts' private keys as the wrong key type, so their payments were rejected.
- In the browser, wallet signatures were applied to a payment prepared for several network nodes, so most copies were invalid. The fix was proven with real HBAR and USDC payments.
- Wallet disconnect didn't stick, reconnect happened silently, and wallet errors appeared as an empty `{}`.

**Clean Hedera codebase**
- All Algorand code, assets, skills, settings and wording are removed from the working files.
- Discovery adapts to testnet or mainnet, HBAR prices are calculated without rounding errors, and everything is configured from one `.env` file.

**New features, live on Hedera testnet**

| Feature | Details |
|---|---|
| Real x402 payments | HBAR and USDC through the hosted Blocky402 facilitator, which pays the network fee. Evidence in `docs/SETTLEMENTS.md` |
| Audit trail on Hedera Consensus Service | Topic `0.0.11331606`. The merchant logs each sale, the agent logs each spend, and both record the same fingerprint (hash) of the data. Viewable at `/explore/audit` and `GET /v1/audit/recent` |
| ERC-8004 agent identities | Finality is agent #144 and the research agent is #145, in the shared registries on Hedera's EVM side. Lookups via `/v1/erc8004/*` |
| Autonomous research agent | `npm run agent`: discovers the catalog, plans calls, applies spending rules (budget, per-call and per-merchant limits, allowed payees, human approval above a threshold), pays, logs to the audit trail, and rates the merchant on-chain. Run recorded in `docs/AGENT_RUNS.md` |
| Wallets | One Connect button. HashPack pays x402; MetaMask on Hedera EVM (chain 296) handles identity and on-chain ratings |
| Tooling | Hedera agent skills, a hedera-docs MCP config, the build tracker, and the `npm run test:wallet:e2e` wallet test |

## Working now
- Paying for data with HashPack in the browser: connect, pay, disconnect, and reconnect with approval.
- The autonomous agent paying with no human involved, logging every decision, and leaving on-chain reputation.
- Public discovery documents (`/.well-known/x402`, `agent.json`, `llms.txt`) that include the identity and audit topic.
- Accounts, all funded:

| Account | ID |
|---|---|
| Treasury | `0.0.11331489` |
| Operator | `0.0.11331211` |
| Agent | `0.0.11331261` |
| MetaMask | `0.0.11332415` |

## Pending (build infrastructure)
1. **Step 14b, MetaMask paying x402.** It uses our own facilitator on Hedera EVM with an EIP-3009 test-dollar token. The plan is in the tracker, and the existing HashPack + Blocky402 flow stays untouched.
2. **Step 15, submission pack:** README, demo-video script, and a review with the submission-validator skill.
3. **Deploy to Render** (backend, frontend and agent).
4. **Housekeeping:** the `next dev` block in `AGENTS.md` (commit it or ignore it), and restart Claude Code to load the hedera-docs MCP.

## Next phase: the product's core

The payment, identity and audit layers are in place. The product's value now comes from the data and intelligence layer:

1. **Data aggregation layer**
   - Data adapters for CoinMarketCap, CoinGecko, DexScreener, the Hedera Mirror Node and chain RPC endpoints, all behind one standard data format. Each record should state its source, freshness and time.
   - Cross-source checks: compare prices, flag outliers, and show a confidence score.
   - Caching, rate limits and fallbacks, keeping the existing honesty rule: no invented metrics, and sample data is always labelled.
   - Discovery of new data sources from their `/.well-known/x402` catalogs, so Finality can resell or combine them.
2. **Intelligence layer**
   - Free or fine-tuned models (Ollama, Groq or Gemini already wired; local fine-tunes later) for signals, summaries and anomaly detection over the aggregated data.
   - An evaluation harness: backtest signals against history and publish accuracy, and feed the results into ERC-8004 reputation.
3. **Custom agents for users**
   - An agent builder: a goal, data sources, a spending policy (reusing `agent/src/policy.ts`) and a schedule.
   - Each user agent gets its own ERC-8004 identity and audit trail, and pays for data through x402.
   - Marketplace mechanics: agents publish their signals as paid x402 endpoints, building reputation from feedback and accuracy.

`docs/HEDERA_BUILD_TRACKER.md` holds the step-by-step status for any agent continuing the work.
