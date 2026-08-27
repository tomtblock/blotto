#!/usr/bin/env bash
# Validator stage for the end-to-end bench. Carried from the predecessor repository.
#
# Boots a REAL agave solana-test-validator with real mpl-core loaded, at an accelerated slot
# clock, and deploys the current blotto_cup build: dedicated --ledger, --reset, a bounded
# readiness poll, cleanup+trap, non-default ports, and --ticks-per-slot acceleration.
#
# This is a real validator. No surfnet_setAccount, no Surfpool, no litesvm. The point of the
# end-to-end stage is that the accept path is proven on a real SVM — Surfpool's bundled runtime
# does not enforce every check the real one does, and the old repo lost a cycle to exactly that.
#
# PROGRAM_KEYPAIR must point at the program-identity keypair, which lives OUTSIDE this
# repository (see TRANSITION-REPORT.md). Nothing under target/deploy/ is committed here.
#
# C1 adds two genesis-time flags (verified present on solana-test-validator 3.1.10):
#   --account-dir  loads the pristine, unmodified Switchboard Randomness accounts dumped from
#                  devnet, so `commit_vrf_seed` can run against real oracle-produced bytes.
#   --warp-slot    boots the ledger just below those accounts' real `reveal_slot`s, since
#                  `get_value` only returns the value when clock.slot == reveal_slot.
# Both are genesis configuration of a REAL validator, not runtime state injection — the
# admissibility judgement is recorded in tests/e2e/lifecycle/vrf.ts.

# shellcheck source=./common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

validator_pidfile() { echo "$E2E_RUN_DIR/validator.pid"; }
validator_logfile() { echo "$E2E_RUN_DIR/validator.log"; }

# Kill any validator bound to OUR ledger dir only. Never a blanket pkill of solana-test-validator:
# a developer may have the B bench or another T2 check running and we must not take it down.
validator_stop() {
  local pidfile; pidfile="$(validator_pidfile)"
  if [ -f "$pidfile" ]; then
    local pid; pid="$(cat "$pidfile" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      # Give it a moment to release the ledger + ports, then insist.
      for _ in 1 2 3 4 5; do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pidfile"
  fi
  # Belt-and-braces: match on the ledger path, which is unique to this bench.
  pkill -f "solana-test-validator.*${E2E_LEDGER}" 2>/dev/null || true
}

# Lowest real reveal_slot across the injected randomness fixtures. Computed by vrf.ts so the
# fixture set stays the single source of truth (no second parse of those files here).
vrf_min_reveal_slot() {
  ( cd "$REPO_ROOT" && yarn --silent run ts-node --transpile-only tests/e2e/lifecycle/vrf.ts )
}

# validator_start [ticks_per_slot]
validator_start() {
  local ticks="${1:-$E2E_TICKS_PER_SLOT}"
  local vlog; vlog="$(validator_logfile)"

  validator_stop
  rm -rf "$E2E_LEDGER"

  local min_reveal warp
  min_reveal="$(vrf_min_reveal_slot)" || die "could not read the randomness fixtures"
  case "$min_reveal" in
    ''|*[!0-9]*) die "vrf.ts did not return a numeric reveal slot (got: '$min_reveal')" ;;
  esac
  warp=$((min_reveal - E2E_VRF_RUNWAY_SLOTS))

  log "booting solana-test-validator (ticks-per-slot=$ticks, rpc=:$E2E_RPC_PORT) with real mpl-core"
  log "  warping to slot $warp — ${E2E_VRF_RUNWAY_SLOTS} slots below the lowest real reveal_slot ($min_reveal)"
  nohup solana-test-validator \
    --reset --quiet \
    --ledger "$E2E_LEDGER" \
    --rpc-port "$E2E_RPC_PORT" \
    --faucet-port "$E2E_FAUCET_PORT" \
    --gossip-port "$E2E_GOSSIP_PORT" \
    --ticks-per-slot "$ticks" \
    --warp-slot "$warp" \
    --bpf-program "$MPL_CORE_ID" "$REPO_ROOT/tests/fixtures/mpl_core.so" \
    --account-dir "$E2E_VRF_FIXTURE_DIR" \
    >"$vlog" 2>&1 &
  echo $! > "$(validator_pidfile)"

  if ! poll_until 60 "validator RPC at $E2E_RPC" solana cluster-version -u "$E2E_RPC"; then
    warn "validator did not come up; log tail:"; tail -30 "$vlog" >&2
    # --quiet sends the panic to the LEDGER's validator.log, not stdout, so the tail above is
    # usually empty. The real reason (port collision, bad fixture) is in here.
    if [ -f "$E2E_LEDGER/validator.log" ]; then
      warn "ledger validator.log tail:"; tail -15 "$E2E_LEDGER/validator.log" >&2
    fi
    return 1
  fi
  log "validator up (slot $(solana slot -u "$E2E_RPC"))"
}

validator_deploy_program() {
  log "building program (cargo build-sbf)"
  ( cd "$REPO_ROOT" && cargo build-sbf >/dev/null 2>&1 ) || die "cargo build-sbf failed"
  test -f "$REPO_ROOT/target/idl/blotto_cup.json" \
    || die "missing target/idl/blotto_cup.json — run 'anchor build' once"

  log "funding deployer from the local faucet + deploying blotto_cup ($PROGRAM_ID)"
  # Single 100-SOL request, not chunked — the QA-A10-001 identical-signature airdrop dedup bug
  # only bites multi-chunk airdrops, so there is nothing to dedup here.
  solana airdrop 100 "$E2E_WALLET" -u "$E2E_RPC" >/dev/null 2>&1 \
    || die "faucet airdrop failed (faucet port $E2E_FAUCET_PORT)"
  ( cd "$REPO_ROOT" && solana program deploy \
      --program-id "$PROGRAM_KEYPAIR" \
      target/deploy/blotto_cup.so -u "$E2E_RPC" >/dev/null ) \
    || die "blotto_cup deploy failed"
  log "blotto_cup deployed"
}
