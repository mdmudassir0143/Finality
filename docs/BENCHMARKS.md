# Agent benchmarks

Live runs of `npm run agents -- bench <agent>`: real model calls and real x402 payments on Hedera testnet.
Scoring is deterministic (agents/bench/score.ts). ERROR = the model provider failed (quota, rate limit, overload);
those tasks are excluded from pass rate and means. Regenerated from agents/bench/results on every run.

## 2026-11-06T08:27:48.870Z — intelligence · gemini-3.5-flash · intelligence-v1

**3/3 passed** (3 provider errors) · mean score 100% · spent $1.20 · 55.6 s/task · 5.0 steps · 4.3 tool calls · 37615 tokens/task. Raw: `agents/bench/results/intelligence-v1-gemini-3.5-flash-2026-11-06T08-27-48-870Z.json`

| Task | Result | Score | Spent | Latency | Failed checks |
|---|---|---|---|---|---|
| hbar-price | PASS | 100% | $0.15 | 16.6 s | — |
| network-health | ERROR | — | $0.25 | 21.9 s | provider error |
| account-balance-free | ERROR | — | $0.00 | 8.0 s | provider error |
| audit-topic-free | ERROR | — | $0.00 | 7.6 s | provider error |
| sentiment | PASS | 100% | $0.45 | 74.5 s | — |
| budget-discipline | PASS | 100% | $0.35 | 75.8 s | — |
