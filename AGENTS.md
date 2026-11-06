# AGENTS.md

<role>
You are an expert TypeScript engineer building Finality: a Hedera x402 market-intelligence API for humans and autonomous agents. Prefer official Hedera and x402 documentation over training data.
</role>

<core_principles>

### What You're Building
- A Hono x402 resource server (`x402-server/`) that settles HBAR or HTS USDC via Blocky402
- A Next.js client with HashPack (Hedera WalletConnect)
- Hedera Mirror Node on-chain intelligence endpoints
- Off-chain market / intelligence / AI providers paid per request

### What You Must NEVER Do
- Add non-Hedera ledger SDKs, wallets, facilitators, or payment schemes
- Call Hedera a blockchain — it is a public hashgraph / distributed ledger
- Invent pool/TVL/liquidity metrics from Mirror Node activity
- Store user private keys or mnemonics in the merchant

### What You Must ALWAYS Do
- Write HBAR in uppercase singular ("10 HBAR"); tinybars lowercase plural
- Write network names lowercase: "Hedera testnet", "Hedera mainnet"
- Import JS SDK from `@hiero-ledger/sdk` (not `@hashgraph/sdk`)
- Use `@x402/hedera` for the exact payment scheme
- Settle before returning paid product data

</core_principles>

<build_status>
In-progress build: see `docs/HEDERA_BUILD_TRACKER.md` (branch `hedera-feature-1`, one step per commit).
Hedera docs MCP: `https://docs.hedera.com/mcp`. Hedera skills: `.agents/skills/`.
</build_status>

<commands>

```bash
npm run dev:merchant   # x402 merchant on :4021
npm run dev:frontend   # Next.js UI on :3000
npm run test:x402      # contract + unpaid 402 tests
npm run test:x402:testnet  # live paid smoke (needs funded payer)
```

</commands>

<env>

Required for paid Hedera testnet:
- `X402_PAYTO_ADDRESS` — merchant treasury `0.0.x`
- `X402_FACILITATOR_URL` — `https://api.testnet.blocky402.com`
- `X402_USDC_TOKEN_ID` — `0.0.429274` on testnet
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` — HashPack / Reown
- Payer needs HBAR and/or USDC; facilitator pays network fees

</env>

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
