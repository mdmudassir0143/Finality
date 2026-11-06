# Agents tracker (Phase C)

Finality agents: LLM agents built on the **Hedera Agent Kit v4** (`@hashgraph/hedera-agent-kit`) through the
**Vercel AI SDK** adapter, with **Gemini** as the model. Each agent is a declarative `AgentSpec` run by one runner,
so agents are comparable in benchmarks and a builder UI only has to produce a spec. Resume from the first
unchecked step; same rules as `docs/HEDERA_BUILD_TRACKER.md` (gate green, one step per commit).

```
agents/
  core/spec.ts        AgentSpec (id, bio, HCS-11 capabilities, plugins, policy, maxSteps, system prompt)
  core/runner.ts      runSpec(): AI SDK generateText + HederaAIToolkit; wraps tools → [S#] citations, timings, payments
  core/trace.ts       RunTrace (steps, tool calls, tokens, spend, answer, unknown citations)
  core/env.ts         live wiring: agent account (HCS-11 or shared payer), x402 MerchantSession, HCS audit, ERC-8004
  core/model.ts       Gemini via @ai-sdk/google (GEMINI_API_KEY, GEMINI_MODEL)
  core/provision.ts   HCS-11 profile + own account (@hashgraphonline/standards-sdk)
  plugins/finality/   HAK plugin: finality_catalog_tool, finality_budget_tool, finality_call_tool (x402 under policy)
  specs/              built-in agents (intelligence) + registry
  bench/              task suites (JSON), deterministic scorer, live runner → docs/BENCHMARKS.md
  registry/<net>.json public HCS-11 ids (keys stay in .env as AGENT_<ID>_PRIVATE_KEY)
agent/src/session.ts  MerchantSession: 402 → policy → pay → receipt → HCS spend → ERC-8004 feedback (shared with `npm run agent`)
```

Commands: `npm run agents -- list | run <id> --goal "…" | provision <id> | bench <id>`.

## Steps

- [x] **C1: Agent core.** AgentSpec, runner, trace, Gemini model factory, Finality HAK plugin (BaseTool query tools),
      `MerchantSession` extracted from the deterministic agent so both share one spend policy. Paid-call input is a
      JSON string (Gemini rejects schema-less object parameters). Tests: `x402-server/tests/agent/intelligence-agent.test.ts`
      (scripted model: catalog → paid call → cited answer; budget denial; bad input never pays; invented citations flagged).
- [x] **C2: Intelligence agent.** `agents/specs/intelligence.ts`: read-only Hedera query plugins (account, token,
      consensus, transaction, misc) + Finality plugin; cited markdown brief. Live run 2026-11-06 with
      gemini-3.5-flash: free exchange-rate read [S1] + `market.quotes` [S2] + `onchain.hederaNetworkNodes` [S3],
      $0.30 of $0.50, 6 steps, 37 s (docs/AGENT_RUNS.md). Found and fixed: discovery treated the fUSD rail's 0x payee
      as a conflicting payee and allowlisted none, so every purchase was denied (regression test added).
- [x] **C3: HCS-11 identity.** Own provisioner (the SDK's inscription service returned 401): account 0.0.11336166
      (ECDSA, key saved first), HCS-10 inbound 0.0.11336167 / outbound 0.0.11336170, HCS-11 profile as an HCS-1 file
      on 0.0.11336171, account memo `hcs-11:hcs://1/0.0.11336171`, all verified on the Mirror Node. The public
      Hashgraph Online registry call failed on their side (empty response); retry with `npm run agents -- provision
      intelligence`. An earlier SDK attempt left an orphan account 0.0.11336138 whose key was never returned.
- [ ] **C4: Benchmarks.** Harness done (`agents/bench/`, suite `intelligence-v1`, 6 tasks). Provider failures
      (quota, rate limit, overload) are scored ERROR and excluded; reports are rebuilt from stored traces
      (`npm run agents -- bench-report`); `--delay` paces tasks. First live run, gemini-3.5-flash: 3/3 scored tasks
      passed, 3 provider errors (Gemini free-tier quota). gemini-3.8-flash hit quota/overload on every task and was
      stopped. **Next:** re-run all three models once the key has quota (paid tier or next day).
- [x] **C5: Agents page.** `/explore/agents` (dashboard tab + site nav): agent card (HCS-11 account/profile/topics
      with HashScan links, live HBAR balance, budget, tools, capabilities, run command), benchmark table per model,
      task × model matrix (PASS / FAIL / ERROR with failed checks), recent HCS spend records filtered to the agent.
      Data from agents/specs/meta.ts (shared with the spec), agents/registry and agents/bench/results via lib/agents/data.ts.
- [ ] **C6: Run from the UI.** Merchant route `POST /v1/agents/:id/run` (itself x402-paid: agent-as-a-service),
      streaming the trace; the agent pays sub-calls from its own HCS-11 account.
- [ ] **C7: Custom agent builder.** UI → AgentSpec (name, bio, goal template, plugins, budget, max steps, model);
      saved per wallet; benchmarked on the same suites.
- [ ] **C8: More agents + check-and-balance.** Auditor (cross-checks HCS `sale` vs `spend` sha256 for every run),
      Risk/anomaly, On-chain analyst; agents talk over HCS-10 topics; Auditor rates others via ERC-8004.

## Notes
- `GEMINI_MODEL` was `gemini-2.0-flash`, which Google retired; now `gemini-3.8-flash`. It returned 503 "high
  demand" on 2026-11-06, so live runs used `--model gemini-3.5-flash`.
- Benchmarks disable ERC-8004 feedback so test traffic does not move the merchant's reputation.
- `package.json` override for `@hashgraph/hedera-wallet-connect` pins `@hiero-ledger/sdk` to `2.90.1` (npm could
  not resolve the `$@hiero-ledger/sdk` reference while adding the agent kit). zod 4.6.7 is installed as `zod4` for
  HAK tool schemas; the rest of the repo stays on zod 3.
