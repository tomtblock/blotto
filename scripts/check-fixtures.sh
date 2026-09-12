#!/usr/bin/env bash
#
# The Python oracles still produce the vectors that are committed.
#
# WHY (audit 2026-09-11, finding F-13). Three generators in this repository
# are INDEPENDENT ORACLES: plain-Python implementations of a rule, written so
# that the committed vectors come from something other than the code under
# test. CLAUDE.md states the reason in one line — "a vector captured from our
# own Rust output proves nothing" — and the scoring vectors are load-bearing
# beyond testing, because a player recomputing their own result checks it
# against exactly these numbers.
#
# None of the three was executed by any workflow. A generator could be edited
# and its vectors left alone, or the vectors hand-edited into something the
# generator would never emit, and every lane stayed green. An oracle nobody
# runs is a comment.
#
#   backend/scoring/fixtures/gen_vectors.py      → fixtures/vectors.json AND
#                                                  programs/blotto_cup/src/merkle_vectors.rs
#   backend/packet/fixtures/gen_vectors.py       → fixtures/vectors.json
#   crates/blotto-randomness/fixtures/gen_vectors.py → fixtures/vectors.json
#
# TWO MECHANISMS, ON PURPOSE. Two of the three write nothing without
# `--write` and print the payload to stdout instead, so this script can
# regenerate and diff without the generator's help — which is the stronger
# arrangement, because the comparison is then outside the thing being
# checked and cannot be fooled by a `--check` that lies. The scoring oracle
# needs its own `--check` (added the same day) for one reason: it emits a
# SECOND artifact, the Rust merkle fixture, which never appears on stdout
# and so cannot be diffed from out here.
#
# The generators are pure standard-library Python with no I/O, no network and
# no clock, so a difference is always a real difference.
#
#   exit 0   every committed fixture is what its oracle computes
#   exit 1   one is not, or an oracle would not run; the difference is printed
#   exit 2   this check is broken (--self-test failed)

set -uo pipefail
# Absolute, captured BEFORE the cd, so the self-test re-invocation below
# works no matter which directory this was called from.
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MAX_DIFF_LINES=40

# ---------------------------------------------------------------------------
# compare_stdout LABEL DIR SCRIPT COMMITTED
#
# Run SCRIPT from DIR with no arguments (its print-only mode), and compare
# what it prints with the COMMITTED file, byte for byte. Prints one
# `fixtures FAILED:` line per problem; returns 1 on any.
# ---------------------------------------------------------------------------
compare_stdout() {
  local label="$1" dir="$2" script="$3" committed="$4"
  local out err rc
  out="$(mktemp)"; err="$(mktemp)"
  if ! ( cd "$dir" && python3 "$script" ) >"$out" 2>"$err"; then
    echo "fixtures FAILED: ${label} — the oracle itself did not run:"
    sed 's/^/    /' "$err"
    rm -f "$out" "$err"
    return 1
  fi
  if [ ! -f "$committed" ]; then
    echo "fixtures FAILED: ${label} — ${committed} does not exist; the oracle produces it"
    rm -f "$out" "$err"
    return 1
  fi
  if diff -u "$committed" "$out" >"$err" 2>&1; then
    echo "ok: ${label} — ${committed} is exactly what the oracle computes"
    rm -f "$out" "$err"
    return 0
  fi
  echo "fixtures FAILED: ${label} — ${committed} is not what the oracle computes"
  head -n "$MAX_DIFF_LINES" "$err" | sed 's/^/    /'
  if [ "$(wc -l <"$err")" -gt "$MAX_DIFF_LINES" ]; then
    echo "    … and $(( $(wc -l <"$err") - MAX_DIFF_LINES )) more diff lines"
  fi
  rm -f "$out" "$err"
  return 1
}

# ---------------------------------------------------------------------------
# Self-test: the comparison must report a difference, must accept a match,
# and must not read a crashed generator as agreement.
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--self-test" ]; then
  probe="$(mktemp -d)"
  trap 'rm -rf "$probe"' EXIT
  mkdir -p "$probe/fixtures"
  printf 'print("one")\nprint("two")\n' > "$probe/fixtures/gen.py"
  printf 'one\nWRONG\n' > "$probe/fixtures/vectors.json"

  failures=""
  probe_out="$(compare_stdout probe "$probe" fixtures/gen.py "$probe/fixtures/vectors.json" 2>&1)"
  probe_rc=$?
  if [ "$probe_rc" = "0" ]; then
    failures="${failures}${failures:+, }a differing fixture was reported as ok"
  fi
  if ! printf '%s\n' "$probe_out" | grep -qF 'is not what the oracle computes'; then
    failures="${failures}${failures:+, }the difference was not named"
  fi
  if ! printf '%s\n' "$probe_out" | grep -qF 'WRONG'; then
    failures="${failures}${failures:+, }the diff did not show WHAT differs"
  fi

  printf 'one\ntwo\n' > "$probe/fixtures/vectors.json"
  if ! compare_stdout probe "$probe" fixtures/gen.py "$probe/fixtures/vectors.json" >/dev/null 2>&1; then
    failures="${failures}${failures:+, }a matching fixture was reported as drift"
  fi

  # A generator that cannot run is a failure, never a pass. Without this, a
  # renamed import or a syntax error would produce empty output, and an
  # empty committed file would then "agree" with it.
  printf 'import nonexistent_module_for_the_probe\n' > "$probe/fixtures/gen.py"
  crash_out="$(compare_stdout probe "$probe" fixtures/gen.py "$probe/fixtures/vectors.json" 2>&1)"
  if [ $? = 0 ]; then
    failures="${failures}${failures:+, }a crashed oracle was reported as ok"
  fi
  if ! printf '%s\n' "$crash_out" | grep -qF 'the oracle itself did not run'; then
    failures="${failures}${failures:+, }a crashed oracle was not named as such"
  fi

  # And a committed file that is not there at all.
  rm -f "$probe/fixtures/vectors.json"
  printf 'print("one")\n' > "$probe/fixtures/gen.py"
  missing_out="$(compare_stdout probe "$probe" fixtures/gen.py "$probe/fixtures/vectors.json" 2>&1)"
  if ! printf '%s\n' "$missing_out" | grep -qF 'does not exist'; then
    failures="${failures}${failures:+, }a missing committed fixture was not named"
  fi

  if [ -n "$failures" ]; then
    echo "fixtures: BROKEN — this check failed its own self-test."
    echo
    echo "Not caught on the probe: $failures"
    echo
    echo "A comparison that does not fire on a deliberate difference is not"
    echo "comparing anything. Fix the check; never delete the probe."
    exit 2
  fi
  echo "fixtures self-test: drift reported, a match accepted, a crashed oracle and a missing fixture both refused."
  exit 0
fi

# ---------------------------------------------------------------------------
# The real oracles. Run the self-test first: this check reports a verdict
# only after proving its own detector fires (scripts/ci-gate.sh, same
# reasoning).
# ---------------------------------------------------------------------------
"$SELF" --self-test >/dev/null || exit 2

fail=0

# The scoring oracle checks itself, because one of its two outputs is a Rust
# file rather than stdout. It prints its own ok/DRIFT lines.
if ! ( cd backend/scoring && python3 fixtures/gen_vectors.py --check ); then
  fail=1
fi

compare_stdout "packet layout oracle" backend/packet fixtures/gen_vectors.py \
  backend/packet/fixtures/vectors.json || fail=1

compare_stdout "randomness oracle" crates/blotto-randomness fixtures/gen_vectors.py \
  crates/blotto-randomness/fixtures/vectors.json || fail=1

if [ "$fail" -ne 0 ]; then
  echo
  echo "A committed fixture no longer matches the oracle that is supposed to"
  echo "be its independent source. Regenerate it (\`--write\` from the package"
  echo "root) and commit both together — or, if the ORACLE is what changed,"
  echo "say so in the change: a rule the vectors encode is a rule players"
  echo "recompute their own result against."
  exit 1
fi
echo "fixtures: all three Python oracles reproduce their committed vectors (self-test passed)"
