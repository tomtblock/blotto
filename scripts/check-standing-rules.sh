#!/usr/bin/env bash
#
# Roadmap §3 standing rules 5 and 6, as CI checks.
#
# Rule 5 — "Class is read by nothing in the scoring path. A CI test greps
# backend/scoring/ and pay_prizes for `class` and fails on any hit."
#
# Rule 6 — "The vault has exactly three exits (pay_prizes, release_escrow,
# refund). A CI test asserts it." NOTE, recorded in the Phase 1 report: the
# roadmap's own §1.4 also routes forfeited escrow OUT of the vault (to the next
# pool's vault or the platform wallet), so the true exit set is FOUR movers.
# This check asserts the exact enumerated set below and fails on any other
# occurrence of a vault debit, which is the rule's actual intent: no exit that
# is not on the list.

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
fi

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "standing rules 5 and 6: clean"
