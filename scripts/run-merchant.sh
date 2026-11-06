#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env && ! -f x402-server/.env ]]; then
  echo "Missing .env. Run: cp .env.example .env"
  exit 1
fi

echo "Starting Finality merchant API at http://localhost:4021"
exec npm run dev:x402
