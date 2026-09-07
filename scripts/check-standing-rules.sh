#!/usr/bin/env bash
#
# Roadmap §3 standing rules 5 and 6, as CI checks.
#
# Rule 5 — "Class is read by nothing in the scoring path. A CI test greps
# backend/scoring/ and pay_prizes for `class` and fails on any hit."
#
# Rule 6 — "The vault has exactly three exits (pay_prizes, release_escrow,
# refund). A CI test asserts it." History: the roadmap's §1.4 added a fourth
# mover, forfeit-to-treasury (Phase 1 report). Since the founder ruling of
# 2026-09-07 (prompt v2 §E — forfeited money never reaches the operator) the
# exit set is: pay_prizes, release_escrow, pay_next_place, refund
# (trigger_refund's pot return and the per-entry refund both live in
# refund.rs). `forfeit_escrow` is NO LONGER an exit — check (h) below pins
# that, and that nothing in escrow.rs can address the treasury at all.
# This check asserts the exact enumerated set below and fails on any other
# occurrence of a vault debit, which is the rule's actual intent: no exit that
# is not on the list.
#
# D-A1 revised (master prompt v2, 2026-08-27) adds the platform TREASURY —
# a separate account, not a fifth vault exit — with three checks of its own:
# (e) platform_debit call sites are exactly open_pool / refund / treasury
#     (withdraw_platform being the one gated exit);
# (f) register credits NO prize vault — entries never touch one;
# (g) no pot arithmetic: the program never derives a pot from entries or a
#     balance (pots are fixed Config/constant values copied at open).

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
fail=0

# ---- Rule 5: no `class` in the scoring path --------------------------------
# Whole-word, case-insensitive, source files only. backend/scoring/ must not
# mention class at all; the payout handler must not either (it pays ranks).
for target in backend/scoring/src backend/scoring/fixtures/gen_vectors.py \
              programs/blotto_cup/src/instructions/pay_prizes.rs; do
  [ -e "$target" ] || continue
  hits="$(grep -rniE '\bclass(es)?\b' "$target" 2>/dev/null || true)"
  if [ -n "$hits" ]; then
    echo "standing-rule 5 FAILED: 'class' appears in the scoring path ($target):"
    echo "$hits"
    fail=1
  fi
done

# ---- Rule 6: the vault's exits are exactly the enumerated set --------------
# Every lamport debit from the vault PDA goes through the one helper
# `vault_debit(` (defined in programs/blotto_cup/src/vault.rs). This check
# asserts (a) no other vault-seeded invoke_signed transfer exists, and (b) the
# helper is called only from the allowed instruction files.
PROG=programs/blotto_cup/src
if [ -d "$PROG" ]; then
  # (a) vault seeds may appear in a signed CPI only inside vault.rs itself.
  raw="$(grep -rln 'VAULT_SEED' $PROG --include='*.rs' | grep -vE '(state\.rs|vault\.rs|events\.rs)$' | while read -r f; do
    grep -l 'invoke_signed' "$f" || true
  done)"
  if [ -n "$raw" ]; then
    echo "standing-rule 6 FAILED: raw vault-signed CPI outside vault.rs:"
    echo "$raw"
    fail=1
  fi
  # (b) vault_debit call sites: exactly the allowed exit instructions.
  allowed='pay_prizes|escrow|refund'
  sites="$(grep -rln 'vault_debit(' $PROG/instructions --include='*.rs' 2>/dev/null || true)"
  for f in $sites; do
    base="$(basename "$f")"
    if ! echo "$base" | grep -qE "^(${allowed})\.rs$"; then
      echo "standing-rule 6 FAILED: vault_debit called from unlisted instruction: $f"
      fail=1
    fi
  done
  # (c) the transfer chokepoint: `system_program::transfer` may appear ONLY in
  # vault.rs. Any other occurrence is a lamport path that dodges the audit
  # surface — exactly what rule 6 exists to prevent.
  stray="$(grep -rln 'system_program::transfer' $PROG --include='*.rs' | grep -v '/vault\.rs$' || true)"
  if [ -n "$stray" ]; then
    echo "standing-rule 6 FAILED: system_program::transfer outside vault.rs:"
    echo "$stray"
    fail=1
  fi
  # (d) the platform treasury's seeds may appear in a signed CPI only inside
  # vault.rs (same chokepoint discipline as the vault).
  praw="$(grep -rln 'PLATFORM_SEED' $PROG --include='*.rs' | grep -vE '(state\.rs|vault\.rs|events\.rs)$' | while read -r f; do
    grep -l 'invoke_signed' "$f" || true
  done)"
  if [ -n "$praw" ]; then
    echo "standing-rule 6 FAILED: raw platform-signed CPI outside vault.rs:"
    echo "$praw"
    fail=1
  fi
  # (e) platform_debit call sites: pot funding (open_pool.rs), entry refunds
  # (refund.rs) and the one Squads-gated exit (treasury.rs) — nothing else
  # drains the treasury.
  platform_allowed='open_pool|refund|treasury'
  psites="$(grep -rln 'platform_debit(' $PROG/instructions --include='*.rs' 2>/dev/null || true)"
  for f in $psites; do
    base="$(basename "$f")"
    if ! echo "$base" | grep -qE "^(${platform_allowed})\.rs$"; then
      echo "standing-rule 6 FAILED: platform_debit called from unlisted instruction: $f"
      fail=1
    fi
  done
  # (f) entries never touch a prize vault: register.rs must not pass the
  # vault account into any transfer (its only permitted use is the read-only
  # belt-and-braces pot assertion via `.lamports()`), and must not debit it.
  if grep -nE 'accounts\.vault\.to_account_info|vault_debit\(' $PROG/instructions/register.rs >/dev/null; then
    echo "standing-rule 6 FAILED: register.rs moves lamports to/from the prize vault"
    fail=1
  fi
  # (h) 2026-09-07: escrow.rs never names the treasury (no PLATFORM_SEED, no
  # platform_debit, no `platform` account), and the forfeit handler moves no
  # lamports — a forfeited share can only leave the vault by next-place payout.
  if grep -nE 'PLATFORM_SEED|platform_debit|\bplatform\b\s*:' $PROG/instructions/escrow.rs >/dev/null; then
    echo "standing-rule 6 FAILED: escrow.rs can address the platform treasury"
    fail=1
  fi
  forfeit_body="$(awk '/^pub fn handle_forfeit_escrow/{on=1} on{print} on && /^}/{exit}' $PROG/instructions/escrow.rs)"
  if [ -z "$forfeit_body" ]; then
    echo "standing-rule 6 FAILED: handle_forfeit_escrow not found in escrow.rs"
    fail=1
  elif echo "$forfeit_body" | grep -qE 'vault_debit\(|invoke|transfer'; then
    echo "standing-rule 6 FAILED: forfeit_escrow moves lamports"
    fail=1
  fi
  # (g) no pot arithmetic: a pot is a fixed value copied at open, never
  # derived from entries or balances. Fail on any arithmetic combining
  # pot_lamports with entry counts, entry prices, or live balances.
  pot_arith="$(grep -rnE 'pot_lamports\s*[*+]|[*+]\s*pot_lamports|pot_lamports\s*=\s*[^;]*(entrants|entry_lamports|lamports\(\))' $PROG --include='*.rs' || true)"
  if [ -n "$pot_arith" ]; then
    echo "standing-rule 6 FAILED: pot arithmetic reading entries or balances:"
    echo "$pot_arith"
    fail=1
  fi
fi

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "standing rules 5 and 6: clean"
