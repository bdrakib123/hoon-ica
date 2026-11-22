#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "ERROR: @cexi/hoonica requires Node.js >=20 (found $(node --version))." >&2
  exit 1
fi

echo "== Runtime regression tests =="
npm test

echo
echo "== TypeScript declaration check =="
npm run test:types

echo
if [ -f package-lock.json ]; then
  echo "== Dependency security audit =="
  npm audit --audit-level=low
else
  echo "WARNING: package-lock.json not found; npm audit was skipped."
fi

echo
echo "== npm package dry-run =="
npm pack --dry-run

echo
echo "RELEASE CHECK PASSED"
echo "Node.js: $(node --version)"
echo "npm: $(npm --version)"
echo "Note: this does not verify a live Instagram login or publish the package."
