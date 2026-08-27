#!/usr/bin/env bash
#
# Devnet deploy (C12) — the one script behind docs/devnet-rehearsal.md
# step 1 plus the data-plane catch-up:
#
#   1. put the REAL program keypair in place (never committed — the path
#      comes from the environment),
#   2. `anchor build` + `anchor deploy` against devnet,
#   3. apply every pending database migration (the forward-only runner:
#      a clean database gets all of them; an existing one gets exactly
#      the new files — 0004/0005/0006/... in filename order),
#   4. `re-derive` the derived tables from the events ledger.
#
# Environment:
#   BLOTTO_PROGRAM_KEYPAIR   path to the program keypair JSON (required)
#   BLOTTO_DATABASE_URL      the indexer database (required for steps 3-4;
#                            skipped with a warning when unset)
#   ANCHOR_PROVIDER_URL      cluster override (default: devnet)
#
# Refuses to run if the keypair's pubkey does not match the program's
# declared id — deploying under a different id would strand every client.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

DECLARED_ID="$(grep -o 'declare_id!("[^"]*")' programs/blotto_cup/src/lib.rs | cut -d'"' -f2)"

if [ -z "${BLOTTO_PROGRAM_KEYPAIR:-}" ]; then
  echo "deploy: BLOTTO_PROGRAM_KEYPAIR is not set (path to the program keypair)" >&2
  exit 1
fi
KEYPAIR_PUBKEY="$(solana-keygen pubkey "$BLOTTO_PROGRAM_KEYPAIR")"
if [ "$KEYPAIR_PUBKEY" != "$DECLARED_ID" ]; then
  echo "deploy: keypair pubkey $KEYPAIR_PUBKEY does not match declare_id $DECLARED_ID" >&2
  exit 1
fi

mkdir -p target/deploy
cp "$BLOTTO_PROGRAM_KEYPAIR" target/deploy/blotto_cup-keypair.json

echo "deploy: building..."
anchor build

echo "deploy: deploying $DECLARED_ID to devnet..."
anchor deploy --provider.cluster "${ANCHOR_PROVIDER_URL:-devnet}"
solana program show "$DECLARED_ID" --url devnet

if [ -n "${BLOTTO_DATABASE_URL:-}" ]; then
  echo "deploy: applying pending migrations..."
  BLOTTO_DATABASE_URL="$BLOTTO_DATABASE_URL" npm --prefix backend/indexer run migrate
  echo "deploy: rebuilding derived tables..."
  BLOTTO_DATABASE_URL="$BLOTTO_DATABASE_URL" npm --prefix backend/indexer run re-derive
else
  echo "deploy: BLOTTO_DATABASE_URL not set — migrations + re-derive SKIPPED (run them before serving)" >&2
fi

echo "deploy: done. Next: transfer the upgrade authority to the Squads vault"
echo "        (docs/devnet-rehearsal.md step 1) and start the services."
