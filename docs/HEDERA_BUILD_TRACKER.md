# Hedera build tracker

This file is the shared, resumable state for finishing Finality on Hedera and preparing the
ETHGlobal "AI Agents That Pay: x402 on Hedera" submission. Any coding agent can pick up from
the first unchecked step.

- **Branch:** `hedera-feature-1` (tracks `origin/hedera-feature-1`, cut from `hedera`)
- **Product story:** a pay-per-call market + Hedera intelligence API, plus an autonomous research
  agent that discovers the catalog, spends within a policy, pays via x402 (HBAR or USDC, Blocky402),
  and writes every spend and sale to an HCS audit topic.

## Handoff protocol

1. `git switch hedera-feature-1 && git pull --ff-only`, read this file, then `git log --oneline -15`.
2. Run the **gate** on a clean tree. If it is red, fix that first; never stack work on a red tree.
3. Do **only the next unchecked step**, touching only the files that step lists.
4. Gate green → tick the step here, commit `hedera(step N): <title>`, `git push`.
   Gate red and not fixable inside the step → `git restore` that step's files, record the blocker
   below, commit + push that note.
5. Never edit files owned by a later step. Never batch steps. One step = one commit = one push.
6. Uncommitted work is not handed off: discard a half-done step and redo it.

**Git rules:** stage paths explicitly (no `git add -A`); check `git diff --cached` for secrets;
no force-push, rebase or amend of pushed commits; never push to `hedera` or `main`; if a push is
rejected, `git pull --rebase`, rerun the gate, push.

**Gate:**

```bash
npm run test:x402 && npx tsc --noEmit && (cd keeper && npx tsc --noEmit)
# frontend steps (app/, components/, lib/ used by Next) also:
npm run build
```

**Phase B rule:** every hackathon feature is off when its env is unset, and its Hedera network
calls are mocked in its own vitest file.

**Tooling:** the hedera-docs MCP (`https://docs.hedera.com/mcp`; `claude mcp add --transport http
hedera-docs https://docs.hedera.com/mcp`, VS Code config in `.vscode/mcp.json`). Hedera skills live
in `.agents/skills/` (symlinked into `.claude/skills/`, pinned in `skills-lock.json`):
x402-payments, hedera-consensus-service, hedera-token-service, agent-kit-plugin,
hedera-agent-kit-v4-migration, hedera-policy-creation, hedera-hook-creation, hiero-cli,
hedera-hackathon-prd, hedera-hackathon-submission-validator.

## Phase A: fixes and cleanup

- [x] **Step 0: Bootstrap and tooling.** Dependency override committed, upstream created, tracker,
      hedera-docs MCP, Hedera skills, `.vscode/mcp.json`.
- [x] **Step 1: payTo precedence (critical).** `PLATFORM.payTo = '0.0.0'` is truthy, so
      `PLATFORM.payTo || env.X402_PAYTO_ADDRESS` always advertises `0.0.0`.
      Files: `x402-server/discovery/platform.ts`, `x402-server/config/payment.ts` (`resolvePayTo`),
      `x402-server/middleware/x402.ts`, `x402-server/routes/public.ts`, `lib/facilitator.ts`,
      `x402-server/tests/payments/unpaid.test.ts`.
      Done when: a 402 advertises `payTo` from `X402_PAYTO_ADDRESS` (tested), and nothing displays `0.0.0` as real.
- [x] **Step 2: Mirror transaction ID.** `fetchHederaTransaction` sends `0.0.x@s.n`; the Mirror
      Node needs `0.0.x-s-n`. Add `toMirrorTransactionId` in `lib/onchain/hedera/mirror.ts` (400 on
      bad input) plus the offline test `x402-server/tests/endpoints/mirror-txid.test.ts`.
- [x] **Step 3: Server residue.** Drop the leftover upstream token header from `json()` in
      `x402-server/services/operation.ts`; drop the unused `usdc` local in `paymentAccepts`; remove the
      unused `X402_HBAR_ASSET` from `x402-server/config/env.ts` and `.env.example`.
- [x] **Step 4: Network-aware discovery + static assets.** `platform.ts` builders take a
      `DiscoveryCtx` (caip2, networkLabel, usdcTokenId, facilitator, payTo, usdPerHbar) built in
      `routes/public.ts`; HBAR resources get real tinybar amounts; rewrite `public/.well-known/x402`
      and the copy lines in `public/og.svg`; mainnet discovery test in `tests/contract/public.test.ts`.
- [x] **Step 5: Result views (frontend; gate + build).** In `components/ResultPresentation.tsx`, add
      an account and balances view (HBAR balance from tinybars, token table), remove the dead portfolio
      and DeFi id checks, and drop the stale currency-regex key.
- [x] **Step 6: Association terminology.** Keeper module `keeper/src/associate.ts`
      (`associate*ToUsdc`, `associatedUsdc`, `associateTxId`, `associate.*` logs), CLI and npm scripts
      `associate` / `funders-associate`, `keeper/README.md`; payer helper `scripts/associate-test-usdc.ts`
      (`npm run associate:test-usdc`). Older state files are mapped forward on load
      (`normalizeAssociationFields` in `keeper/src/types.ts`).
- [x] **Step 7: Repo purge.** Removed the legacy `.github/skills/` set and an unused provider logo,
      rewrote `.github/copilot-instructions.md` for Hedera, mapped `HBAR` → `hedera-hashgraph` in
      `lib/providers/coingecko.ts`, and made the AGENTS.md guardrail generic. Remaining "opt-in" words
      live only in vendored Hedera skill docs (general English, pinned by `skills-lock.json`).
- [x] **Step 8: Phase A verification** (2026-11-06).
      - Gate: test:x402 75/75, tsc root + keeper clean, next build ok. Trace check clean.
      - Blocky402 testnet `/supported` lists `exact` on `hedera:testnet` with feePayer `0.0.7162784`.
      - Local merchant with `X402_PAYTO_ADDRESS=0.0.12345`: unpaid `GET /v1/onchain/hedera/network/supply`
        returns 402 with exactly two accepts, USDC `0.0.429274` amount `100000` and HBAR `0.0.0` amount `50000000`,
        both with payTo `0.0.12345` and feePayer `0.0.7162784`. `/.well-known/x402` and `/llms.txt` match.
      - Mainnet discovery is covered by `tests/contract/public.test.ts`.
      - **Not run:** `npm run test:x402:testnet`, because no `.env` or funded payer exists yet (see Step 9).
      - **Manual (owner, HashPack):** an HBAR payment, USDC association plus a USDC payment, and a tamper test
        (change amount or payTo, which should be rejected).

- [x] **Step 8b: HBAR payments blocked by client spend controls** (found while doing Step 9).
      In `@x402/core`, only "default assets" (USDC on Hedera) pass `spendControls`, so the HBAR (`0.0.0`)
      option was silently dropped and the browser paid USDC instead. The fix is `hederaSpendControls()` in
      `lib/x402/spend.ts`, which allows HBAR with a 25 HBAR (2,500,000,000 tinybar) per-payment cap. The
      browser client now uses it and errors instead of falling back to another asset. Tested in
      `x402-server/tests/payments/client-spend.test.ts`. The keeper is unaffected because it pays USDC.

## Phase B: hackathon features

- [x] **Step 9: First real settlement (evidence).** Both assets settled live on Hedera testnet through Blocky402:
      HBAR `0.0.7162784@1793922288.636099269` and USDC `0.0.7162784@1793922904.693328440` (agent `0.0.11331261` →
      treasury `0.0.11331489`, fee paid by the facilitator). Evidence is in `docs/SETTLEMENTS.md`. Accounts (all ECDSA):
      treasury `0.0.11331489`, operator `0.0.11331211`, agent `0.0.11331261`. Fixed along the way: the scripts parsed
      raw-hex keys as ED25519 and now use `parseHederaPrivateKey`.
- [x] **Step 10: HCS audit trail (merchant).** Shared `finality.audit.v1` schema (`sale` + `spend`) in
      `lib/hedera/audit.ts`; queued fire-and-forget `AuditPublisher` in `lib/hedera/hcs.ts`; key parsing in
      `lib/hedera/keys.ts`; `x402-server/audit/sale.ts` builds the sale message (op, payer, payTo, asset,
      amount, network, payment tx, sha256 of the delivered bytes) from an `onAfterSettle` hook in
      `x402-server/middleware/x402.ts`. It is off unless `HCS_AUDIT_TOPIC_ID`, `MERCHANT_OPERATOR_ID` and
      `MERCHANT_OPERATOR_KEY` are all set, and `/health` shows `hcsAudit`. Topic: `npm run hcs:create-audit-topic`
      (admin key and submit key are the merchant key). Tests: `x402-server/tests/payments/audit.test.ts`
      (end-to-end paid request with mocked Blocky402). **Live topic creation is pending** the merchant operator
      account (same owner input as Step 9).
- [x] **Step 11: Audit visibility.** Free `GET /v1/audit/recent` (`x402-server/routes/audit.ts`) reads the
      topic from the Mirror Node, keeps only valid `finality.audit.v1` records and returns HashScan links for each
      HCS record and payment. `/explore/audit` dashboard tab with 15s refresh. The audit topic is advertised in
      `/.well-known/x402` (`audit`), `agent.json` (`auditTopicId`) and `llms.txt`. Documented in
      `docs/api-endpoints.md`. Tests: `x402-server/tests/contract/audit-feed.test.ts`. The page and Next proxy
      were checked at runtime (`enabled:false` until a topic is configured).
### EVM-first direction (decided 2026-11-06)

ETHGlobal track, so the stack is EVM-first. Verified facts:
- Every facilitator in the Hedera x402 docs (Official x402, Launa, Blocky402) settles only the **native** `exact`
  scheme on `hedera:testnet` / `hedera:mainnet`. None supports Hedera EVM (`eip155:296`). HTS USDC has no
  EIP-3009. x402 payments therefore stay native and are signed by HashPack or by an ECDSA key via
  `createClientHederaSigner`.
- One ECDSA key is both a Hedera account (`0.0.x`) and an EVM address (`0x…` alias). The agent uses one key for
  its ERC-8004 identity (EVM) and for its x402 payments (native).
- One wallet kit, Reown AppKit + `HederaAdapter` from `@hashgraph/hedera-wallet-connect`, handles `hedera`
  (HashPack) and `eip155` (MetaMask, chain 296 via `https://testnet.hashio.io/api`).

### Owner inputs (blocking live runs only)

1. One **ECDSA** Hedera testnet account from portal.hedera.com (merchant/operator) → root `.env`:
   `X402_PAYTO_ADDRESS`, `MERCHANT_OPERATOR_ID`, `MERCHANT_OPERATOR_KEY`.
2. About 20 testnet USDC from faucet.circle.com (Hedera testnet) for the agent and HashPack accounts.
3. A Reown project ID → `.env` `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`.
4. HashPack (testnet) and MetaMask with Hedera testnet (chain 296) for the demo.
5. Later, a Render redeploy from this branch.

- **ERC-8004 is already deployed on Hedera testnet** (canonical erc-8004/erc-8004-contracts, verified live via
  Hashio: bytecode present, `getVersion()` = `2.0.0`): IdentityRegistry `0x8004A818BFB912233c491871b3d84c89A494BD9e`,
  ReputationRegistry `0x8004B663056A597Dffe9eCcC1965A193B7388713`, agentRegistry
  `eip155:296:0x8004A818BFB912233c491871b3d84c89A494BD9e`. Step 12 uses these instead of deploying copies.
- [x] **Step 12: ERC-8004 identity + reputation on Hedera EVM.** Uses the canonical registries (no own deploy).
      `lib/evm/erc8004.ts` (viem 2.57.16, `hederaTestnet` via Hashio) covers ABIs, the on-chain `data:` registration
      file, register/setAgentURI/giveFeedback, and `readAgent` (reputation averaged from `readAllFeedback`).
      `npm run erc8004:register -- merchant|agent` is idempotent. **Live:** Finality is agent **#144** (owner
      operator EVM alias `0xBB16…Ca98`, tx `0xe6860ed7…c3b6`) and the research agent is **#145** (owner
      `0x7Ff7…8938`, tx `0xa2073f63…5a8b`). Free `GET /v1/erc8004/merchant` and `/v1/erc8004/agents/:id`; discovery
      advertises `identity` (well-known x402, agent.json) and `registrations` (agent card) plus an llms.txt line.
      Tests: `x402-server/tests/contract/erc8004.test.ts`. No Hardhat workspace was needed.
- [x] **Step 13: Autonomous research agent.** `agent/` runs in the root workspace and reuses `lib/`:
      `src/discovery.ts` (well-known x402 + catalog, ERC-8004 identity check), `src/planner.ts` (deterministic goal →
      plan), `src/policy.ts` (identity, payTo allowlist against bait-and-switch, price drift vs discovery, per-call,
      budget, per-merchant, human approval threshold), `src/run.ts` (402 → policy → pay → receipt → HCS `spend` →
      ERC-8004 feedback with feedbackHash = data SHA-256), and `cli.ts` (`npm run agent -- --goal … --budget …`).
      `npm run hcs:allow-agent` set the audit topic submit key to 1-of-2 (merchant, agent). Tests:
      `x402-server/tests/agent/agent.test.ts` (policy, planner, end-to-end against the in-process merchant).
      **Live run** (`docs/AGENT_RUNS.md`): 4 USDC calls ($0.50 of $1.00) with no human, 4 HCS spend records,
      4 ERC-8004 feedback transactions, and Finality #144 reputation of 4 reviews averaging 100. For every call the
      merchant's HCS sale-record SHA-256 equals the agent's SHA-256.
- [ ] **Step 14: One wallet kit in the browser.** **Verified end-to-end by `npm run test:wallet:e2e`; owner Brave
      retest pending.** Reown AppKit 1.8.24 + `HederaAdapter` (`hedera` for HashPack, `eip155` for MetaMask on 296).
      Fixes from owner testing:
      (1) The browser x402 transfer is frozen for a single node: a wallet signs one node's body, and a multi-node freeze
      left invalid signature copies.
      (2) Disconnect ends AppKit (connected namespaces only), the WalletConnect session and all pairings, then resets
      AppKit account state. Stale "connected" events after a disconnect are ignored, so there is no silent reconnect.
      (3) The kit singleton lives on `globalThis`, so dev HMR no longer creates a second WalletConnect Core.
      (4) "Connect HashPack" opens the modal filtered to the Hedera namespace (HashPack, Kabila, SaucerSwap Wallet,
      Venly) and "EVM wallet" filters to eip155, so HashPack cannot land on the EVM path.
      (5) A 120 s wallet-sign timeout and readable facilitator errors.
      (6) The wallet button is an account menu.
      `scripts/e2e-wallet.ts` drives headless Chrome while a real WalletConnect test wallet (`HederaWeb3Wallet`, the
      protocol HashPack implements) pairs, signs and disconnects. It passed connect → pay (HBAR and USDC settled; HCS
      #13/#14) → disconnect → fresh-approval reconnect with 0 warnings or errors, on both the production build and
      `next dev`.
      Final wallet UX (owner feedback): there is ONE "Connect wallet" button with a chooser. HashPack goes through the
      AppKit Hedera namespace (pays x402). MetaMask is connected directly via EIP-1193 (EIP-6963 discovery prefers
      MetaMask over Brave Wallet; switches/adds chain 296) for ERC-8004 identity and reputation. The deprecated
      AppKit eip155 adapter is removed, which ends its errors and the empty-CAIP warnings. Wallet sign errors are
      readable (rejected vs code/message). Verified: HashPack e2e passes (0 warnings), and the MetaMask path was
      checked with an injected EIP-6963 provider (accounts + chain switch + rating buttons).
      Known noise: "AccountBalanceQuery deprecated" is logged by the Hedera adapter's own balance polling (library).
- [x] **Step 14b: MetaMask pays x402, standard EVM `exact` scheme on Hedera EVM via OUR facilitator** (2026-11-06).
      Purely additive: the HashPack + Blocky402 flow is unchanged and `npm run test:wallet:e2e` still passes
      (connect → HBAR pay → disconnect → fresh-approval reconnect, 0 warnings / 0 errors). Commits 14b.1–14b.5:
      1. **Token** `contracts/FinalityUSD.sol`: fUSD, ERC-20 (6 decimals) + EIP-3009 on OpenZeppelin, compiled with
         solc-js (`npm run fusd:compile`, evmVersion paris; no Hardhat workspace needed, same as Step 12). Deployed by the
         operator to `0x8Bb1d3aa637A54859dcC772EB01fE45eEECE482f` (`contracts/deployments/hedera-testnet.json`,
         `npm run fusd:deploy -- <addr…>` also mints). Hashio verified: chainId 296, raw tx, receipts, eth_call, ecrecover.
      2. **Facilitator** `facilitator/` (Hono, :4022, `npm run dev:facilitator`): `x402Facilitator` + `@x402/evm`
         `ExactEvmScheme` for eip155:296. Dedicated gas wallet `FACILITATOR_EVM_KEY` (`0xAABf…D97B` = `0.0.11334505`,
         refused if equal to the merchant/payer key). Policy before any RPC: only fUSD, only eip155:296, only payee
         `X402_EVM_PAYTO_ADDRESS` (treasury alias `0x153c…68e8`), 32 KB bodies. `lib/evm/fusd.ts` shared config.
      3. **Merchant** (additive): with `X402_EVM_FACILITATOR_URL` + `X402_EVM_PAYTO_ADDRESS` set, a third accept
         (exact / eip155:296 / fUSD, EIP-712 name+version in `extra`); second facilitator client + `ExactEvmScheme`.
         Unset = exactly the two native accepts. HCS `sale` and `spend` accept 0x payTo/asset; audit feed links EVM tx
         hashes; `/.well-known/x402`, agent.json, llms.txt advertise the rail. `npm run dev:all` starts the facilitator
         when its key is set. `hederaSpendControls({ fusd })` allows fUSD with a $5 cap.
      4. **Browser**: MetaMask session → Run page shows "fUSD (MetaMask)" + fUSD balance and pays via
         `callPaidResourceWithEvm` (eth_signTypedData_v4 only; the payer needs no HBAR). Payment errors now render next
         to PAY NOW. Verified in Brave/Chrome with real MetaMask `0x9ae2…5b30`.
      5. **Tests/evidence**: `x402-server/tests/contract/facilitator.test.ts`, `x402-server/tests/payments/evm-rail.test.ts`
         (121/121 total); live `npm run test:x402:evm` (injected EIP-1193 signer); settlements in `docs/SETTLEMENTS.md`
         (HCS sales #28, #29, #31 on `0.0.11331606`).
      Qualification note: self-hosted facilitators are allowed by the track. fUSD is a test token, not Circle USDC
      (HTS USDC has no EIP-3009); Circle USDC stays on the HashPack/Blocky402 path.
      Known gaps: the MetaMask session is not restored after a page reload (no `eth_accounts` restore in
      `lib/hedera/wallet.tsx`), and the header shows DISCONNECTED for an EVM address with no Hedera account yet.

- [ ] **Step 15: Evidence + submission pack.** Live runs (audit topic, ERC-8004 deploy, Step 9 smoke, agent run),
      README (setup, architecture, payment flow, transaction IDs, topic, contracts, controls, checklist),
      `docs/DEMO.md`, and a review with the hedera-hackathon-submission-validator skill.

## Blockers / notes

- **Resolved by Step 14b (option D: own EVM facilitator + fUSD).** Historical note on why the Snap route was dropped:
  **MetaMask paying x402 (option A, Hedera Wallet Snap): blocked; verified 2026-11-06 from the
  `@hashgraph/hedera-wallet-snap@0.6.2` source (`src/index.tsx`).** The Snap's RPC methods are `signMessage`,
  `transferCrypto`, `hts/*`, `hcs/*`, `hscs/*`, staking and allowances. None of them signs an arbitrary partially
  signed transaction and returns it, which the x402 `exact` Hedera scheme needs (payer signs, Blocky402 co-signs as
  fee payer and submits). `transferCrypto` signs AND submits itself, so the payer pays the fee and there is no
  facilitator, which is not x402. MetaMask's native signing (EVM) cannot sign Hedera transactions, and no
  facilitator supports x402 on Hedera EVM (eip155:296), and HTS USDC has no EIP-3009.
  Options for a future session: (B) a separate pay-then-verify mode (MetaMask sends an HTS USDC/HBAR transfer or a
  Snap `transferCrypto`, and the merchant verifies it on the Mirror Node before serving) offered next to standard
  x402; or keep (C): HashPack pays x402, MetaMask handles ERC-8004 identity and reputation (current, tested).
  MetaMask test account: `0.0.11332415` / `0x8a0c…bd17` (funded). USDC shows in MetaMask after importing the token
  at `0x0000000000000000000000000000000000068cda` (USDC, 6 decimals).

- Step 1 also fixed the same precedence bug for `X402_PUBLIC_URL` (env first, then `PLATFORM.apiBase`).

- 2026-11-06: Baseline on `hedera` was 62/62 tests passing and tsc clean (root + keeper).
- Git history still contains the pre-Hedera code; rewriting history is out of scope.
