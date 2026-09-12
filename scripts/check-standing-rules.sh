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
#
# TWO THINGS CHANGED ON 2026-09-12 (audit 2026-09-11, Tier 3 item 1):
#
#   A MISSING TARGET IS A FAILURE. Until then every rule-6 check sat inside
#   `if [ -d "$PROG" ]` and every rule-5 target was `|| continue`, so a
#   renamed directory made the whole gate print "clean" and exit 0 with
#   nothing checked. A control over the vault's exits that passes when the
#   vault's source has moved is not a control.
#
#   THE GATE TESTS ITSELF, the way scripts/check-language.sh does: the same
#   check function runs against a probe tree that violates every rule, and
#   must fail on each one — and then against the real tree. A gate whose
#   grep quietly stopped matching would otherwise report a clean tree
#   forever. Exit 2 means the gate is broken; exit 1 means the tree is.
#
# ADDED 2026-09-12 (audit 2026-09-11, finding A-34): check (i) enumerates
# FUNCTIONS, not files. (b) and (e) allow-list the FILES that may call
# `vault_debit(` / `platform_debit(`, so a second handler — or a private
# helper — added to escrow.rs, pay_prizes.rs, refund.rs, open_pool.rs or
# treasury.rs that called either helper would have passed CI unseen. (i)
# splits every instructions/*.rs into its top-level fn bodies (the extractor
# check (h) already used for handle_forfeit_escrow, generalised) and requires
# every body that calls either helper to be one of the seven named `file:fn`
# pairs. A call site the extractor cannot place inside any body (an impl
# block, a macro, a const) is itself a failure: the per-file grep count must
# equal the count attributed to bodies, so the check can never skip a call
# site in silence. (b) and (e) stay as the cheap first layer.

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# ---------------------------------------------------------------------------
# run_checks ROOT — every rule, against the tree under ROOT. Prints one
# `standing-rule N(x) FAILED: …` line per failure; returns 1 on any.
# ---------------------------------------------------------------------------
run_checks() {
  local root="$1"
  local fail=0

  # ---- Rule 5: no `class` in the scoring path ------------------------------
  # Whole-word, case-insensitive, source files only. backend/scoring/ must not
  # mention class at all; the payout handler must not either (it pays ranks).
  local target hits
  for target in backend/scoring/src backend/scoring/fixtures/gen_vectors.py \
                programs/blotto_cup/src/instructions/pay_prizes.rs; do
    if [ ! -e "$root/$target" ]; then
      echo "standing-rule 5(missing) FAILED: scoring-path target not found: $target"
      fail=1
      continue
    fi
    hits="$(grep -rniE '\bclass(es)?\b' "$root/$target" 2>/dev/null || true)"
    if [ -n "$hits" ]; then
      echo "standing-rule 5(class) FAILED: 'class' appears in the scoring path ($target):"
      echo "$hits"
      fail=1
    fi
  done

  # ---- Rule 6: the vault's exits are exactly the enumerated set ------------
  # Every lamport debit from the vault PDA goes through the one helper
  # `vault_debit(` (defined in programs/blotto_cup/src/vault.rs). This check
  # asserts (a) no other vault-seeded invoke_signed transfer exists, and (b) the
  # helper is called only from the allowed instruction files.
  local PROG="$root/programs/blotto_cup/src"
  if [ ! -d "$PROG" ] || [ ! -d "$PROG/instructions" ]; then
    echo "standing-rule 6(missing) FAILED: program source not found at programs/blotto_cup/src — nothing was checked"
    return 1
  fi

  # (a) vault seeds may appear in a signed CPI only inside vault.rs itself.
  local raw
  raw="$(grep -rln 'VAULT_SEED' "$PROG" --include='*.rs' | grep -vE '(state\.rs|vault\.rs|events\.rs)$' | while read -r f; do
    grep -l 'invoke_signed' "$f" || true
  done)"
  if [ -n "$raw" ]; then
    echo "standing-rule 6(a) FAILED: raw vault-signed CPI outside vault.rs:"
    echo "$raw"
    fail=1
  fi
  # (b) vault_debit call sites: exactly the allowed exit instructions.
  local allowed='pay_prizes|escrow|refund' sites f base
  sites="$(grep -rln 'vault_debit(' "$PROG/instructions" --include='*.rs' 2>/dev/null || true)"
  for f in $sites; do
    base="$(basename "$f")"
    if ! echo "$base" | grep -qE "^(${allowed})\.rs$"; then
      echo "standing-rule 6(b) FAILED: vault_debit called from unlisted instruction: $f"
      fail=1
    fi
  done
  # (c) the transfer chokepoint: `system_program::transfer` may appear ONLY in
  # vault.rs. Any other occurrence is a lamport path that dodges the audit
  # surface — exactly what rule 6 exists to prevent.
  local stray
  stray="$(grep -rln 'system_program::transfer' "$PROG" --include='*.rs' | grep -v '/vault\.rs$' || true)"
  if [ -n "$stray" ]; then
    echo "standing-rule 6(c) FAILED: system_program::transfer outside vault.rs:"
    echo "$stray"
    fail=1
  fi
  # (d) the platform treasury's seeds may appear in a signed CPI only inside
  # vault.rs (same chokepoint discipline as the vault).
  local praw
  praw="$(grep -rln 'PLATFORM_SEED' "$PROG" --include='*.rs' | grep -vE '(state\.rs|vault\.rs|events\.rs)$' | while read -r f; do
    grep -l 'invoke_signed' "$f" || true
  done)"
  if [ -n "$praw" ]; then
    echo "standing-rule 6(d) FAILED: raw platform-signed CPI outside vault.rs:"
    echo "$praw"
    fail=1
  fi
  # (e) platform_debit call sites: pot funding (open_pool.rs), entry refunds
  # (refund.rs) and the one Squads-gated exit (treasury.rs) — nothing else
  # drains the treasury.
  local platform_allowed='open_pool|refund|treasury' psites
  psites="$(grep -rln 'platform_debit(' "$PROG/instructions" --include='*.rs' 2>/dev/null || true)"
  for f in $psites; do
    base="$(basename "$f")"
    if ! echo "$base" | grep -qE "^(${platform_allowed})\.rs$"; then
      echo "standing-rule 6(e) FAILED: platform_debit called from unlisted instruction: $f"
      fail=1
    fi
  done
  # (f) entries never touch a prize vault: register.rs must not pass the
  # vault account into any transfer (its only permitted use is the read-only
  # belt-and-braces pot assertion via `.lamports()`), and must not debit it.
  if [ ! -f "$PROG/instructions/register.rs" ]; then
    echo "standing-rule 6(f) FAILED: register.rs not found"
    fail=1
  elif grep -nE 'accounts\.vault\.to_account_info|vault_debit\(' "$PROG/instructions/register.rs" >/dev/null; then
    echo "standing-rule 6(f) FAILED: register.rs moves lamports to/from the prize vault"
    fail=1
  fi
  # (h) 2026-09-07: escrow.rs never names the treasury (no PLATFORM_SEED, no
  # platform_debit, no `platform` account), and the forfeit handler moves no
  # lamports — a forfeited share can only leave the vault by next-place payout.
  if [ ! -f "$PROG/instructions/escrow.rs" ]; then
    echo "standing-rule 6(h) FAILED: escrow.rs not found"
    fail=1
  else
    if grep -nE 'PLATFORM_SEED|platform_debit|\bplatform\b\s*:' "$PROG/instructions/escrow.rs" >/dev/null; then
      echo "standing-rule 6(h) FAILED: escrow.rs can address the platform treasury"
      fail=1
    fi
    local forfeit_body
    forfeit_body="$(awk '/^pub fn handle_forfeit_escrow/{on=1} on{print} on && /^}/{exit}' "$PROG/instructions/escrow.rs")"
    if [ -z "$forfeit_body" ]; then
      echo "standing-rule 6(h) FAILED: handle_forfeit_escrow not found in escrow.rs"
      fail=1
    elif echo "$forfeit_body" | grep -qE 'vault_debit\(|invoke|transfer'; then
      echo "standing-rule 6(h) FAILED: forfeit_escrow moves lamports"
      fail=1
    fi
  fi
  # (i) 2026-09-12 (audit 2026-09-11 A-34): (b) and (e) enumerate FILES, so a
  # second handler or a private helper added to an already-listed file could
  # call either debit helper unseen. This check enumerates FUNCTIONS. Every
  # instructions/*.rs is split into its top-level fn bodies: a body starts at
  # a column-0 `fn NAME` / `pub fn NAME` / `pub(crate) fn NAME` line and ends
  # at the next column-0 `}` (the extractor (h) uses for handle_forfeit_escrow,
  # generalised; a fn whose signature line also closes its body — `{ .. }` on
  # one line — is a complete body on its own). Every body that calls
  # `vault_debit(` or `platform_debit(` must be one of the named `file:fn`
  # pairs below, and every call site in the file must sit inside SOME body:
  # the per-file grep count is compared with the count attributed to bodies,
  # and any call site the extractor could not place (an impl block, a macro,
  # a const) fails rather than slipping past. Adding an exit means adding a
  # pair here, in the open, next to the file-level lists above.
  local fn_allowed_vault='escrow.rs:handle_release_escrow escrow.rs:handle_pay_next_place pay_prizes.rs:handle_pay_prizes refund.rs:handle_trigger_refund'
  local fn_allowed_platform='open_pool.rs:handle_open_pool refund.rs:handle_refund treasury.rs:handle_withdraw_platform'
  local helper fn_allowed total attributed outside kind arg count
  for f in "$PROG"/instructions/*.rs; do
    [ -f "$f" ] || continue
    base="$(basename "$f")"
    for helper in vault_debit platform_debit; do
      total="$(grep -o "${helper}(" "$f" 2>/dev/null | wc -l | tr -d '[:space:]')"
      [ "$total" -eq 0 ] && continue
      case "$helper" in
        vault_debit) fn_allowed="$fn_allowed_vault" ;;
        *)           fn_allowed="$fn_allowed_platform" ;;
      esac
      attributed=0
      outside=""
      # Records from the extractor: `FN <name> <count>` per top-level body
      # that contains the helper; `OUT <line> <count>` per call site that is
      # inside no body at all.
      while read -r kind arg count; do
        case "$kind" in
          FN)
            attributed=$((attributed + count))
            case " ${fn_allowed} " in
              *" ${base}:${arg} "*) ;;
              *)
                echo "standing-rule 6(i) FAILED: ${helper} called from unlisted function: ${f}:${arg}"
                fail=1
                ;;
            esac
            ;;
          OUT) outside="${outside}${outside:+,}${arg}" ;;
        esac
      done <<< "$(awk -v needle="${helper}(" '
        function count(s,   n, i) {
          n = 0
          while ((i = index(s, needle)) > 0) { n++; s = substr(s, i + length(needle)) }
          return n
        }
        /^(pub(\(crate\))? +)?fn +[A-Za-z_][A-Za-z0-9_]*[<(]/ {
          # A start while a body is still open closes the open one: a missed
          # closing brace must never let one body swallow the next.
          if (on && cnt > 0) print "FN", cur, cnt
          cur = $0
          sub(/^(pub(\(crate\))? +)?fn +/, "", cur)
          sub(/[<(].*$/, "", cur)
          cnt = count($0)
          if ($0 ~ /\{.*\}[ \t]*$/) { if (cnt > 0) print "FN", cur, cnt; on = 0 } else { on = 1 }
          next
        }
        on {
          cnt += count($0)
          if ($0 ~ /^\}/) { if (cnt > 0) print "FN", cur, cnt; on = 0 }
          next
        }
        { n = count($0); if (n > 0) print "OUT", NR, n }
        END { if (on && cnt > 0) print "FN", cur, cnt }
      ' "$f")"
      if [ "$attributed" -ne "$total" ]; then
        echo "standing-rule 6(i) FAILED: ${helper} called outside any top-level fn body: ${f} (${total} call sites, ${attributed} inside fn bodies; unplaced at line(s) ${outside:-?})"
        fail=1
      fi
    done
  done
  # (g) no pot arithmetic: a pot is a fixed value copied at open, never
  # derived from entries or balances. Fail on any arithmetic combining
  # pot_lamports with entry counts, entry prices, or live balances.
  local pot_arith
  pot_arith="$(grep -rnE 'pot_lamports\s*[*+]|[*+]\s*pot_lamports|pot_lamports\s*=\s*[^;]*(entrants|entry_lamports|lamports\(\))' "$PROG" --include='*.rs' || true)"
  if [ -n "$pot_arith" ]; then
    echo "standing-rule 6(g) FAILED: pot arithmetic reading entries or balances:"
    echo "$pot_arith"
    fail=1
  fi

  return $fail
}

# ---------------------------------------------------------------------------
# Self-test: a probe tree that violates every rule must fail on every rule,
# and a tree with no program source must fail rather than pass. Only then is
# the real tree checked.
# ---------------------------------------------------------------------------
probe="$(mktemp -d)"
trap 'rm -rf "$probe"' EXIT
mkdir -p "$probe/programs/blotto_cup/src/instructions" "$probe/backend/scoring/src" "$probe/backend/scoring/fixtures"
P="$probe/programs/blotto_cup/src"
# rule 5: `class` in the scoring path, in every target
echo 'const cls = { class: 1 };' > "$probe/backend/scoring/src/x.ts"
echo '# class' > "$probe/backend/scoring/fixtures/gen_vectors.py"
echo '// class' > "$P/instructions/pay_prizes.rs"
# 6(a) + 6(d): a signed CPI over the vault's and the treasury's seeds outside vault.rs
printf 'let s = [VAULT_SEED, PLATFORM_SEED];\ninvoke_signed(&ix, &accs, &[&s])?;\n' > "$P/instructions/sneaky.rs"
# 6(c): the transfer outside vault.rs; 6(e): platform_debit from an unlisted file
printf 'system_program::transfer(cpi, 1)?;\nplatform_debit(&a, 1)?;\n' >> "$P/instructions/sneaky.rs"
# 6(g): a pot derived from entries
printf 'let pot = pool.pot_lamports * pool.entrants as u64;\n' >> "$P/instructions/sneaky.rs"
# 6(b) + 6(f): register debiting the vault
printf 'vault_debit(&ctx.accounts.vault.to_account_info(), 1)?;\n' > "$P/instructions/register.rs"
# 6(h): escrow naming the treasury and a forfeit that moves lamports
printf 'use PLATFORM_SEED;\npub fn handle_forfeit_escrow() -> Result<()> {\n    vault_debit(&v, 1)?;\n    Ok(())\n}\n' > "$P/instructions/escrow.rs"
# 6(i): a SECOND handler in an allowed file, and a private helper plus an
# impl-block method in another allowed file — invisible to the file-level
# lists (b)/(e); the A-34 gap.
printf 'pub fn handle_pay_bonus(ctx: Context<PayBonus>, _pool_id: u64) -> Result<()> {\n    vault_debit(&v, 1)?;\n    Ok(())\n}\n' >> "$P/instructions/pay_prizes.rs"
printf 'fn sweep(a: &AccountInfo, n: u64) -> Result<()> {\n    platform_debit(a, n)?;\n    Ok(())\n}\nimpl Sweeper {\n    fn drain(&self) -> Result<()> {\n        platform_debit(&self.a, 1)?;\n        Ok(())\n    }\n}\n' > "$P/instructions/treasury.rs"
touch "$P/vault.rs"

probe_out="$(run_checks "$probe" 2>&1 || true)"
selftest_failures=""
for expected in '5(class)' '6(a)' '6(b)' '6(c)' '6(d)' '6(e)' '6(f)' '6(g)' '6(h)' '6(i)'; do
  if ! printf '%s\n' "$probe_out" | grep -qF "standing-rule ${expected} FAILED"; then
    selftest_failures="${selftest_failures}${selftest_failures:+, }${expected}"
  fi
done
# 6(i) must name the offender by FUNCTION inside a file that (b)/(e) allow —
# the A-34 gap — and must refuse a call site it cannot place in any fn body.
for expected in \
  '6(i):handler-in-allowed-file=vault_debit called from unlisted function: .*/pay_prizes\.rs:handle_pay_bonus$' \
  '6(i):private-helper=platform_debit called from unlisted function: .*/treasury\.rs:sweep$' \
  '6(i):outside-fn-body=platform_debit called outside any top-level fn body: .*/treasury\.rs \(2 call sites, 1 inside'; do
  if ! printf '%s\n' "$probe_out" | grep -qE "standing-rule 6\(i\) FAILED: ${expected#*=}"; then
    selftest_failures="${selftest_failures}${selftest_failures:+, }${expected%%=*}"
  fi
done
# And the failure mode this rewrite exists for: no program source is a
# failure, never a clean run.
empty="$(mktemp -d)"
empty_out="$(run_checks "$empty" 2>&1 || true)"
rm -rf "$empty"
if ! printf '%s\n' "$empty_out" | grep -qF 'standing-rule 6(missing) FAILED'; then
  selftest_failures="${selftest_failures}${selftest_failures:+, }6(missing)"
fi
if ! printf '%s\n' "$empty_out" | grep -qF 'standing-rule 5(missing) FAILED'; then
  selftest_failures="${selftest_failures}${selftest_failures:+, }5(missing)"
fi

if [ -n "$selftest_failures" ]; then
  echo "standing rules: BROKEN — the gate itself failed its self-test."
  echo
  echo "Not caught on the probe tree: $selftest_failures"
  echo
  echo "A rule that does not fire on a deliberate violation is not enforcing"
  echo "anything. Fix the check; never delete the probe."
  exit 2
fi

# ---------------------------------------------------------------------------
# The real tree.
# ---------------------------------------------------------------------------
if ! run_checks "."; then
  exit 1
fi
echo "standing rules 5 and 6: clean (self-test passed)"
