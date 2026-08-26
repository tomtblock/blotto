#!/usr/bin/env bash
# Shared plumbing for the end-to-end lifecycle bench (tests/e2e). Carried from the predecessor
# repository.
#
# Every value here is BENCH INFRASTRUCTURE (ports, paths, container names) — architect-owned,
# not an economic constant. No PRD/ADR constant is defined or defaulted in this subtree; the
# lifecycle stages read program constants from the deployed IDL / program source, never from here.
#
# Deliberately isolated from any standing dev bench:
#   - Postgres runs in its OWN container on its OWN port with its OWN database (see postgres.sh).
#     backend/docker-compose.yml's `blotto-dev-postgres` on :5432 is the B bench and is left
#     untouched — an end-to-end run must never inherit or destroy a dev bench's state.
#   - The validator uses a dedicated ledger dir and non-default RPC/faucet ports, so a bench run
#     cannot collide with a stray `solana-test-validator` on :8899.

set -euo pipefail

E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$E2E_DIR/../.." && pwd)"

# ---- on-chain identities (both trace to the program source / existing T2 scripts) -------------
MPL_CORE_ID="CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
PROGRAM_ID="57goj6dMYL9BuaGa18jnnTPH7ecztk5rfxiurc4UPW9r"

# ---- bench ports / paths (chosen to avoid a dev bench and the default validator) ---------
E2E_RPC_PORT="${E2E_RPC_PORT:-8999}"
E2E_FAUCET_PORT="${E2E_FAUCET_PORT:-9910}"
# Gossip too. C0 isolated the RPC and faucet ports but left gossip at its 8000 default, which
# every solana-test-validator grabs — so ANY other test validator on the machine (a stray T2
# check, another developer's localnet) makes the bench die at boot with a bare
# "gossip_addr bind_to port 8000: Address already in use" and an EMPTY --quiet log. Found the
# hard way in C1. Isolating it makes the bench's port story complete.
E2E_GOSSIP_PORT="${E2E_GOSSIP_PORT:-8100}"
E2E_RPC="http://127.0.0.1:${E2E_RPC_PORT}"
E2E_LEDGER="${E2E_LEDGER:-$REPO_ROOT/.validator-ledger-e2e}"
E2E_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"

E2E_PG_CONTAINER="${E2E_PG_CONTAINER:-blotto-e2e-postgres}"
E2E_PG_PORT="${E2E_PG_PORT:-55432}"
E2E_PG_USER="blotto"
E2E_PG_PASSWORD="blotto"
E2E_PG_DB="blotto_e2e"
E2E_DATABASE_URL="postgres://${E2E_PG_USER}:${E2E_PG_PASSWORD}@127.0.0.1:${E2E_PG_PORT}/${E2E_PG_DB}"

E2E_INDEXER_PORT="${E2E_INDEXER_PORT:-8980}"

# Slot-clock acceleration. 64 is the agave default (~400ms/slot); the bench default is measured
# and justified in tests/e2e/README.md. Override with E2E_TICKS_PER_SLOT.
E2E_TICKS_PER_SLOT="${E2E_TICKS_PER_SLOT:-8}"

# ---- VRF genesis alignment (C1) ---------------------------------------------------------------
# `commit_vrf_seed` is landable only in a Randomness account's exact `reveal_slot`, so the bench
# boots the ledger *below* the lowest real reveal slot in the injected fixture set and lets the
# clock run up to it. The runway must cover boot + program deploy + wallet funding + launch, all
# measured in SLOTS: at ticks-per-slot=8 (~77ms/slot measured) boot+deploy costs ~115 slots.
#
# C3 raised this from 400 to 600. Wallet funding is inside the runway and is SEQUENTIAL (one
# airdrop request per keypair, never chunked — QA-A10-001), and C3 raised the pool from 6 to 23 to
# fan the remaining opens across the per-wallet cooldown, so that loop now costs ~4x the slots it
# did in C2 and ate most of C1's 400-slot margin.
#
# MEASURED at the current pool: boot -> launch consumed **217 slots** (boot+deploy ~115, then 23
# sequential airdrops and the launch). 600 leaves ~380 slots (~30 s) of headroom, a 2.8x margin.
# The asymmetry matters: `vrf.ts` idles until the band opens, so an over-large runway is SAFE and
# costs only wall clock (~77 ms per idle slot — 900 wasted ~53 s per run), while a too-small one
# FAILS the run outright with "VRF window missed: ... raise E2E_VRF_RUNWAY_SLOTS". Raise it, do
# not shave it, if the pool grows again.
# Fixture dir + warp arithmetic live in tests/e2e/lifecycle/vrf.ts — see the IPC-007
# admissibility judgement recorded there.
E2E_VRF_FIXTURE_DIR="${E2E_VRF_FIXTURE_DIR:-$E2E_DIR/fixtures/switchboard-randomness}"
E2E_VRF_RUNWAY_SLOTS="${E2E_VRF_RUNWAY_SLOTS:-600}"

# Run-scoped scratch. Logs + pidfiles live here so teardown is idempotent and greppable.
E2E_RUN_DIR="${E2E_RUN_DIR:-$REPO_ROOT/.e2e-run}"

log()  { printf '==> %s\n' "$*"; }
warn() { printf '!!  %s\n' "$*" >&2; }
die()  { printf 'xx  %s\n' "$*" >&2; exit 1; }

# High-resolution epoch seconds. macOS `date` has no %N, so use perl (always present on darwin).
now_s() { perl -MTime::HiRes=time -e 'printf "%.3f", time'; }

# Poll a command until it succeeds. poll_until <timeout-seconds> <label> <cmd...>
poll_until() {
  local timeout="$1"; shift
  local label="$1"; shift
  local deadline
  deadline="$(perl -e "print time + $timeout")"
  while :; do
    if "$@" >/dev/null 2>&1; then return 0; fi
    if [ "$(perl -e 'print time')" -ge "$deadline" ]; then
      warn "timed out after ${timeout}s waiting for: $label"
      return 1
    fi
    sleep 1
  done
}

mkdir -p "$E2E_RUN_DIR"
