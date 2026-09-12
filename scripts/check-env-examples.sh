#!/usr/bin/env bash
#
# E1 (master prompt v3): every environment variable the code reads must be
# listed in the matching .env.example — app reads in app/.env.example,
# backend reads in backend/.env.example. An env read with no example entry
# fails CI: the example files are the deploy checklist, and a variable that
# is not on the checklist is an outage waiting for its first deploy.
#
# WIDENED 2026-09-12 (audit 2026-09-11, findings A-09 / E-07 / D-38). Until
# then the gate looked for the literal string `process.env.NAME` and nothing
# else, so it could not see the backend's DOMINANT pattern: a service takes
# `env: NodeJS.ProcessEnv = process.env` as a parameter and every read is
# then `env.NAME`, `env['NAME']` or `requireEnv(env, 'NAME')`. The settlement
# daemon alone reads EIGHTEEN variables that way and the gate saw none of
# them; two of those (KEEPER_KEYPAIR, BLOTTO_INDEXER_ANNOUNCE_URL) were undocumented
# at the time of the audit and passed CI green. A checklist gate that is
# blind to the pattern the code actually uses is not a gate.
#
# What counts as a read (kept deliberately mechanical):
#   1. `env.NAME` / `env['NAME']` anywhere in the scanned trees. This
#      subsumes `process.env.NAME` — `process.env` ends in `env` — so the
#      two forms are one pattern, not two.
#   2. quoted ALL-CAPS names in the designated env-map modules
#      (backend/_shared/src/{config,monitor,http-hygiene,metrics-listener}.ts
#      and backend/indexer/src/config.ts) — the shared loader pattern, where
#      the name is bound to a constant (`export const METRICS_PORT_ENV =
#      'BLOTTO_METRICS_PORT'`) and the read is `portEnv(env, METRICS_PORT_ENV)`.
#      No pattern over the read site can see through that indirection, so the
#      DECLARATION is what gets scanned; adding a module to this list is what
#      a new env-map module costs.
#   3. typed env-parameter keys in the vendor adapters
#      (backend/*/src/*turnkey*.ts, backend/reveal/src/publisher-irys.ts).
#   4. `helper(env, 'NAME')` — the requireEnv shape, where the name is a
#      string argument rather than a property.
#
# Scanned trees: app/src, backend/*/src, backend/*/test, backend/*/scripts.
# TEST FILES ARE SCANNED ON PURPOSE. A comment in the pre-2026-09-12 version
# claimed they were excluded, but the filter (`grep -v '\.test\.'` after a
# `grep -oh`, whose output carries no filename) could never match anything,
# so they were scanned all along. Keeping them scanned is the stronger of
# the two readings: a variable a test reads is a variable that exists, and
# the file's own rule already says extra rows are documentation while
# missing rows are bugs. backend/*/scripts is new here — an operator script
# (backend/packet/scripts/check-entry-signer.ts) reads credentials, and what
# an operator must set is exactly what the checklist is for.
#
# The reverse direction is NOT enforced: the examples may document
# variables the code does not read yet (deploy-script paths, forward
# entries for the next step) — extra rows are documentation, missing rows
# are bugs.
#
# THE GATE TESTS ITSELF (`--self-test`), the way scripts/check-language.sh,
# scripts/check-standing-rules.sh and scripts/ci-gate.sh do. A probe tree
# hides one read behind EVERY supported pattern and documents none of them;
# all of them must be reported missing, and the widened `env.NAME` pattern
# is named explicitly in that list so it cannot be quietly lost again. A
# second probe documents the same reads and must come back clean, so the
# gate cannot pass by reporting everything as missing either.
#
#   exit 0   every read is documented
#   exit 1   a read is undocumented (or a scanned tree has gone missing)
#   exit 2   the gate itself is broken (self-test failed)

set -uo pipefail
# Absolute, captured BEFORE the cd, so the self-test re-invocation below
# works no matter which directory this was called from.
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# ---------------------------------------------------------------------------
# The read patterns. Defined once, used by both the real run and the probe.
#
# `\benv\.` matches `process.env.` too: the character before `env` is `.`,
# which is a non-word character, so the word boundary holds. One pattern
# covers the injected-env read and the direct process.env read alike.
#
# A name is four characters or more. The patterns match inside comments as
# well as code — grep cannot tell them apart — and the shortest real
# variable name in either tree is eight characters, while `env.X` in a doc
# comment explaining a defect is prose (backend/_shared/src/env-number.ts
# says exactly that). Four is the line: it admits any plausible name
# (`PORT`) and rejects the one- and two-letter placeholders prose uses.
# ---------------------------------------------------------------------------
NAME_RE="[A-Z][A-Z0-9_]{3,}"
READ_RE="\\benv\\.${NAME_RE}|\\benv\\[['\"]${NAME_RE}"
# `requireEnv(env, 'NAME')` and anything else shaped like it.
HELPER_RE="[A-Za-z_][A-Za-z0-9_]*\\(\\s*env\\s*,\\s*['\"]${NAME_RE}"

# names_from_reads — strip everything but the NAME from a match of either
# pattern above. Both end in the name, so one sed does both.
strip_to_name() {
  sed -E "s/.*[.,([]\\s*['\"]?//" | sed -E "s/['\"].*//"
}

# ---------------------------------------------------------------------------
# scan_reads ROOT SCOPE — print one variable NAME per line (unsorted).
#   SCOPE = app      → app/src (*.ts, *.tsx)
#   SCOPE = backend  → backend/*/{src,test,scripts} (*.ts) plus the two
#                      structured forms (env-map modules, vendor adapters)
# ---------------------------------------------------------------------------
scan_reads() {
  local root="$1" scope="$2"
  if [ "$scope" = "app" ]; then
    grep -rhoE "$READ_RE" "$root/app/src" \
      --include='*.ts' --include='*.tsx' 2>/dev/null | strip_to_name
    grep -rhoE "$HELPER_RE" "$root/app/src" \
      --include='*.ts' --include='*.tsx' 2>/dev/null | strip_to_name
    return
  fi

  local dirs=()
  local d
  for d in "$root"/backend/*/src "$root"/backend/*/test "$root"/backend/*/scripts; do
    [ -d "$d" ] && dirs+=("$d")
  done
  if [ "${#dirs[@]}" -gt 0 ]; then
    grep -rhoE "$READ_RE" "${dirs[@]}" --include='*.ts' 2>/dev/null | strip_to_name
    grep -rhoE "$HELPER_RE" "${dirs[@]}" --include='*.ts' 2>/dev/null | strip_to_name
  fi

  # The shared loader pattern: these modules hold a table of quoted names.
  # Scoped to named files because a quoted ALL-CAPS string anywhere else in
  # the backend is usually a vendor enum value (CURVE_ED25519,
  # PAYLOAD_ENCODING_HEXADECIMAL) and a gate that cries wolf gets exclusions
  # bolted onto it until it means nothing.
  grep -rhoE "'[A-Z][A-Z0-9]*_[A-Z0-9_]+'" \
    "$root/backend/_shared/src/config.ts" "$root/backend/_shared/src/monitor.ts" \
    "$root/backend/_shared/src/http-hygiene.ts" "$root/backend/indexer/src/config.ts" \
    "$root/backend/_shared/src/metrics-listener.ts" \
    2>/dev/null | tr -d "'"

  # Typed env-parameter keys in the vendor adapters.
  grep -rhoE "^ *[A-Z][A-Z0-9]*_[A-Z0-9_]+\\??:" \
    "$root"/backend/packet/src/signer-turnkey.ts "$root"/backend/sealing/src/custody-turnkey.ts \
    "$root"/backend/reveal/src/publisher-irys.ts 2>/dev/null \
    | sed -E 's/[ ?:]//g'
}

# ---------------------------------------------------------------------------
# check_tree ROOT — the whole gate against one tree. Prints one
# `env gate FAILED: …` line per problem; returns 1 if there was any.
# ---------------------------------------------------------------------------
check_tree() {
  local root="$1" fail=0 name

  # A missing tree is a FAILURE, never a silent clean run — the same rule
  # scripts/check-standing-rules.sh adopted on 2026-09-12. A gate that finds
  # nothing to check must say so, or a renamed directory reads as compliance.
  local tree
  for tree in app/src backend; do
    if [ ! -d "$root/$tree" ]; then
      echo "env gate FAILED: scanned tree not found: $tree (nothing was checked)"
      fail=1
    fi
  done
  if [ "$fail" -ne 0 ]; then return 1; fi
  if [ ! -f "$root/app/.env.example" ] || [ ! -f "$root/backend/.env.example" ]; then
    echo "env gate FAILED: an .env.example is missing (app/.env.example, backend/.env.example)"
    return 1
  fi

  for name in $(scan_reads "$root" app | sort -u); do
    if ! grep -qE "^${name}=" "$root/app/.env.example"; then
      echo "env gate FAILED: ${name} is read by code but missing from app/.env.example"
      fail=1
    fi
  done
  for name in $(scan_reads "$root" backend | sort -u); do
    if ! grep -qE "^${name}=" "$root/backend/.env.example"; then
      echo "env gate FAILED: ${name} is read by code but missing from backend/.env.example"
      fail=1
    fi
  done
  return "$fail"
}

# ---------------------------------------------------------------------------
# Self-test: a probe tree that hides one read behind every supported
# pattern. Every one must be reported; then the same tree with all of them
# documented must come back clean.
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--self-test" ]; then
  probe="$(mktemp -d)"
  trap 'rm -rf "$probe"' EXIT
  mkdir -p "$probe/app/src" "$probe/backend/_shared/src" "$probe/backend/indexer/src" \
           "$probe/backend/packet/src" "$probe/backend/packet/scripts" \
           "$probe/backend/reveal/src" "$probe/backend/reveal/test" \
           "$probe/backend/sealing/src"

  # app: the direct read and the injected-env read.
  printf 'const a = process.env.PROBE_APP_PROCESS;\nconst b = env.PROBE_APP_PROPERTY;\n' \
    > "$probe/app/src/page.tsx"
  # backend src: every read shape the services actually use.
  printf 'const a = process.env.PROBE_PROCESS;\n' > "$probe/backend/reveal/src/main.ts"
  printf 'const b = env.PROBE_PROPERTY;\n' >> "$probe/backend/reveal/src/main.ts"
  printf "const c = env['PROBE_BRACKET'];\\n" >> "$probe/backend/reveal/src/main.ts"
  printf "const d = requireEnv(env, 'PROBE_HELPER');\\n" >> "$probe/backend/reveal/src/main.ts"
  # backend test and operator-script trees are scanned too.
  printf 'const e = env.PROBE_IN_TEST;\n' > "$probe/backend/reveal/test/x.spec.ts"
  printf 'const f = env.PROBE_IN_SCRIPT;\n' > "$probe/backend/packet/scripts/check.ts"
  # the shared-loader table and the vendor-adapter key.
  printf "const t = ['PROBE_MAP_NAME'];\\n" > "$probe/backend/_shared/src/config.ts"
  printf 'export interface A {\n  PROBE_ADAPTER_KEY?: string;\n}\n' \
    > "$probe/backend/packet/src/signer-turnkey.ts"
  : > "$probe/app/.env.example"
  : > "$probe/backend/.env.example"

  probe_out="$(check_tree "$probe" 2>&1 || true)"
  selftest_failures=""
  # PROBE_APP_PROPERTY and PROBE_PROPERTY are the widened pattern — the whole
  # point of this rewrite. Named individually so a regression that loses the
  # property read cannot hide behind the process.env one still firing.
  for expected in PROBE_APP_PROCESS PROBE_APP_PROPERTY PROBE_PROCESS PROBE_PROPERTY \
                  PROBE_BRACKET PROBE_HELPER PROBE_IN_TEST PROBE_IN_SCRIPT \
                  PROBE_MAP_NAME PROBE_ADAPTER_KEY; do
    if ! printf '%s\n' "$probe_out" | grep -qF "env gate FAILED: ${expected} is read"; then
      selftest_failures="${selftest_failures}${selftest_failures:+, }${expected}"
    fi
  done

  # And the other direction: documented reads must come back clean, or a gate
  # that simply reported everything would "pass" the test above.
  printf 'PROBE_APP_PROCESS=\nPROBE_APP_PROPERTY=\n' > "$probe/app/.env.example"
  printf 'PROBE_PROCESS=\nPROBE_PROPERTY=\nPROBE_BRACKET=\nPROBE_HELPER=\n' \
    > "$probe/backend/.env.example"
  printf 'PROBE_IN_TEST=\nPROBE_IN_SCRIPT=\nPROBE_MAP_NAME=\nPROBE_ADAPTER_KEY=\n' \
    >> "$probe/backend/.env.example"
  if ! check_tree "$probe" >/dev/null 2>&1; then
    selftest_failures="${selftest_failures}${selftest_failures:+, }documented-reads-still-failed"
  fi

  # A tree with nothing in it is a failure, not a clean run.
  empty="$(mktemp -d)"
  empty_out="$(check_tree "$empty" 2>&1 || true)"
  rm -rf "$empty"
  if ! printf '%s\n' "$empty_out" | grep -qF 'env gate FAILED: scanned tree not found'; then
    selftest_failures="${selftest_failures}${selftest_failures:+, }missing-tree"
  fi

  if [ -n "$selftest_failures" ]; then
    echo "env gate: BROKEN — the gate failed its own self-test."
    echo
    echo "Not caught on the probe tree: $selftest_failures"
    echo
    echo "A pattern that does not fire on a deliberate violation is not"
    echo "enforcing anything. Fix the check; never delete the probe."
    exit 2
  fi
  echo "env gate self-test: 10 read patterns detected, documented reads clean, missing tree refused."
  exit 0
fi

# ---------------------------------------------------------------------------
# The real tree. Run the self-test first: a gate reports a verdict only
# after proving its own detector fires (scripts/ci-gate.sh, same reasoning).
# ---------------------------------------------------------------------------
"$SELF" --self-test >/dev/null || exit 2

if ! check_tree "."; then
  echo
  echo "Add the variable to the .env.example named above, with one line saying"
  echo "what it is. The example files are the deploy checklist."
  exit 1
fi
echo "env gate: every env read has an example entry (self-test passed)"
