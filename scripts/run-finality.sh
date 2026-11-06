#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env && ! -f x402-server/.env ]]; then
  echo "Missing .env. Run: cp .env.example .env"
  exit 1
fi

# Next.js reads the root .env (single source of truth); .env.local is an optional override.
if [[ ! -f .env && ! -f .env.local ]]; then
  echo "Missing .env. Run: cp .env.example .env"
  exit 1
fi

merchant_pid=""
frontend_pid=""
facilitator_pid=""

cleanup() {
  [[ -n "$merchant_pid" ]] && kill "$merchant_pid" 2>/dev/null || true
  [[ -n "$frontend_pid" ]] && kill "$frontend_pid" 2>/dev/null || true
  [[ -n "$facilitator_pid" ]] && kill "$facilitator_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Optional EVM facilitator (fUSD on Hedera EVM, Step 14b): only when its dedicated gas key is configured.
if grep -qE '^FACILITATOR_EVM_KEY=.+' .env 2>/dev/null; then
  echo "Starting Finality EVM facilitator at http://localhost:4022"
  npm run dev:facilitator &
  facilitator_pid=$!
fi

echo "Starting Finality merchant API at http://localhost:4021"
npm run dev:x402 &
merchant_pid=$!

echo "Starting Finality frontend at http://localhost:3000"
npm run dev &
frontend_pid=$!

wait "$merchant_pid" "$frontend_pid"
