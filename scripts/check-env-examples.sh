#!/usr/bin/env bash
#
# E1 (master prompt v3): every environment variable the code reads must be
# listed in the matching .env.example — app reads in app/.env.example,
# backend reads in backend/.env.example. An env read with no example entry
# fails CI: the example files are the deploy checklist, and a variable that
# is not on the checklist is an outage waiting for its first deploy.
#
# What counts as a read (kept deliberately mechanical):
#   1. `process.env.NAME` / `process.env['NAME']` anywhere under app/src or
#      backend/*/src (test files excluded);
#   2. quoted ALL-CAPS names in the designated env-map modules
#      (backend/_shared/src/{config,monitor,http-hygiene}.ts and
#      backend/indexer/src/config.ts) — the shared loader pattern;
#   3. typed env-parameter keys in the vendor adapters
#      (backend/*/src/*turnkey*.ts, backend/reveal/src/publisher-irys.ts).
#
# The reverse direction is NOT enforced: the examples may document
# variables the code does not read yet (deploy-script paths, forward
# entries for the next step) — extra rows are documentation, missing rows
# are bugs.

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
fail=0

check() { # check <name> <example-file>
  local name="$1" file="$2"
  if ! grep -qE "^${name}=" "$file"; then
    echo "env gate FAILED: ${name} is read by code but missing from ${file}"
    fail=1
  fi
}

# ---- 1. app reads → app/.env.example ---------------------------------------
app_reads="$(grep -rhoE "process\.env\.[A-Z][A-Z0-9_]*|process\.env\[['\"][A-Z][A-Z0-9_]*" app/src \
  --include='*.ts' --include='*.tsx' 2>/dev/null \
  | grep -v '\.test\.' \
  | sed -E "s/process\.env\.?\[?['\"]?//" | sort -u)"
for name in $app_reads; do
  check "$name" app/.env.example
done

# ---- 2. backend process.env reads → backend/.env.example -------------------
backend_reads="$(grep -rhoE "process\.env\.[A-Z][A-Z0-9_]*|process\.env\[['\"][A-Z][A-Z0-9_]*" \
  backend/*/src --include='*.ts' 2>/dev/null \
  | sed -E "s/process\.env\.?\[?['\"]?//" | sort -u)"

# ---- 3. quoted names in the designated env-map modules ---------------------
map_reads="$(grep -rhoE "'[A-Z][A-Z0-9]*_[A-Z0-9_]+'" \
  backend/_shared/src/config.ts backend/_shared/src/monitor.ts \
  backend/_shared/src/http-hygiene.ts backend/indexer/src/config.ts \
  2>/dev/null | tr -d "'" | sort -u)"

# ---- 4. typed env-parameter keys in the vendor adapters --------------------
adapter_reads="$(grep -rhoE "^ *[A-Z][A-Z0-9]*_[A-Z0-9_]+\??:" \
  backend/packet/src/signer-turnkey.ts backend/sealing/src/custody-turnkey.ts \
  backend/reveal/src/publisher-irys.ts 2>/dev/null \
  | sed -E 's/[ ?:]//g' | sort -u)"

for name in $backend_reads $map_reads $adapter_reads; do
  check "$name" backend/.env.example
done

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "env gate: every env read has an example entry"
