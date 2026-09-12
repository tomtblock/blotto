#!/usr/bin/env bash
#
# Program deploy (C12) — the one script behind docs/devnet-rehearsal.md
# step 1 plus the data-plane catch-up:
#
#   1. put the REAL program keypair in place (never committed — the path
#      comes from the environment),
#   2. `anchor build` + `anchor deploy` against the configured cluster,
#   3. apply every pending database migration (the forward-only runner:
#      a clean database gets all of them; an existing one gets exactly
#      the new files — 0004/0005/0006/... in filename order),
#   4. `re-derive` the derived tables from the events ledger.
#
# Environment:
#   BLOTTO_PROGRAM_KEYPAIR   path to the program keypair JSON (required)
#   BLOTTO_CLUSTER           devnet (default) | mainnet
#   BLOTTO_CONFIRM_MAINNET   must be exactly "1" for a mainnet deploy
#   BLOTTO_DATABASE_URL      the indexer database (required for steps 3-4;
#                            skipped with a warning when unset)
#   ANCHOR_PROVIDER_URL      RPC override for `anchor deploy` (default: the
#                            cluster name; export it, a bare assignment on
#                            its own line does not reach child processes)
#
# The file keeps its name because the docs and the runbook cite it; since
# 2026-09-08 the cluster is a variable, not a word in the script. Mainnet is
# refused unless it is asked for twice (BLOTTO_CLUSTER and the confirm flag),
# and refused outright with a keypair whose path names devnet — the mainnet
# program is a FRESH keypair and id, so a devnet key leak can never touch it.
#
# Refuses to run if the keypair's pubkey does not match the program's
# declared id — deploying under a different id would strand every client.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

CLUSTER="${BLOTTO_CLUSTER:-devnet}"
case "$CLUSTER" in
  devnet) ;;
  mainnet)
    if [ "${BLOTTO_CONFIRM_MAINNET:-}" != "1" ]; then
      echo "deploy: BLOTTO_CLUSTER=mainnet also needs BLOTTO_CONFIRM_MAINNET=1 — refusing" >&2
      exit 1
    fi
    ;;
  *)
    echo "deploy: BLOTTO_CLUSTER must be devnet or mainnet (got '$CLUSTER')" >&2
    exit 1
    ;;
esac

DECLARED_ID="$(grep -o 'declare_id!("[^"]*")' programs/blotto_cup/src/lib.rs | cut -d'"' -f2)"

if [ -z "${BLOTTO_PROGRAM_KEYPAIR:-}" ]; then
  echo "deploy: BLOTTO_PROGRAM_KEYPAIR is not set (path to the program keypair)" >&2
  exit 1
fi
if [ "$CLUSTER" = "mainnet" ] && printf '%s' "$BLOTTO_PROGRAM_KEYPAIR" | grep -qi devnet; then
  echo "deploy: refusing a mainnet deploy with a keypair whose path names devnet ($BLOTTO_PROGRAM_KEYPAIR)." >&2
  echo "        The mainnet program is a fresh keypair and id." >&2
  exit 1
fi
KEYPAIR_PUBKEY="$(solana-keygen pubkey "$BLOTTO_PROGRAM_KEYPAIR")"
if [ "$KEYPAIR_PUBKEY" != "$DECLARED_ID" ]; then
  echo "deploy: keypair pubkey $KEYPAIR_PUBKEY does not match declare_id $DECLARED_ID" >&2
  exit 1
fi

mkdir -p target/deploy
cp "$BLOTTO_PROGRAM_KEYPAIR" target/deploy/blotto_cup-keypair.json

echo "deploy: cluster $CLUSTER"
echo "deploy: building..."
anchor build

# E4 (master prompt v3): on an UPGRADE, a build larger than the deployed
# programdata account fails at `anchor deploy` — extend first, by the
# computed shortfall. First deploys (no program on the cluster yet) and
# same-or-smaller builds skip this without error.
NEW_SIZE="$(stat -c%s target/deploy/blotto_cup.so 2>/dev/null || stat -f%z target/deploy/blotto_cup.so)"
CURRENT_SIZE="$(solana program show "$DECLARED_ID" --url "$CLUSTER" 2>/dev/null \
  | grep -oE 'Data Length: [0-9]+' | grep -oE '[0-9]+' || true)"
# The loader refuses an extension smaller than 10,240 bytes ("ExtendProgram
# requires a minimum of 10240 additional bytes or to extend to maximum size")
# — found 2026-09-12 on the first upgrade whose build grew by less than that
# (384 bytes). Round the shortfall up to the minimum; the extra rent is about
# 0.07 SOL once and saves the next small growth from extending at all.
MIN_EXTEND_BYTES=10240
if [ -n "$CURRENT_SIZE" ] && [ "$NEW_SIZE" -gt "$CURRENT_SIZE" ]; then
  EXTEND_BY=$((NEW_SIZE - CURRENT_SIZE))
  if [ "$EXTEND_BY" -lt "$MIN_EXTEND_BYTES" ]; then
    echo "deploy: shortfall is $EXTEND_BY bytes; the loader's minimum extension is $MIN_EXTEND_BYTES"
    EXTEND_BY=$MIN_EXTEND_BYTES
  fi
  echo "deploy: extending programdata by $EXTEND_BY bytes ($CURRENT_SIZE -> $((CURRENT_SIZE + EXTEND_BY)))..."
  solana program extend "$DECLARED_ID" "$EXTEND_BY" --url "$CLUSTER"
elif [ -n "$CURRENT_SIZE" ]; then
  echo "deploy: programdata size $CURRENT_SIZE covers the new build ($NEW_SIZE) — no extend needed"
else
  echo "deploy: program not on the cluster yet — first deploy, no extend needed"
fi

echo "deploy: deploying $DECLARED_ID to $CLUSTER..."
anchor deploy --provider.cluster "${ANCHOR_PROVIDER_URL:-$CLUSTER}"
solana program show "$DECLARED_ID" --url "$CLUSTER"

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
