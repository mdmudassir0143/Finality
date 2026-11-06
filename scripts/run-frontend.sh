#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Next.js reads the root .env (single source of truth); .env.local is an optional override.
if [[ ! -f .env && ! -f .env.local ]]; then
  echo "Missing .env. Run: cp .env.example .env"
  exit 1
fi

echo "Starting Finality frontend at http://localhost:3000"
exec npm run dev
