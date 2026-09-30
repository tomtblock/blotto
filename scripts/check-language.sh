#!/usr/bin/env bash
#
# The PID §8.7 language gate.
#
# PID §8.7 forbids a specific vocabulary. This is a legal-position rule — compliance
# item C12, which blocks launch — not a matter of tone. The failure mode it guards
# against is a single careless identifier surviving from the predecessor repository
# into this one, where it is discoverable.
#
#   Never: lottery · gamble · bet · wager · casino · pull · pack · odds · jackpot ·
#          rake · deal · roll — plus, per roadmap R11/§6.4: promotional · sweepstake
#          (they denote free-entry sweepstakes and put the product in the wrong
#          regulatory box)
#   Use:   entry · pass · character · battle · stat · allocation · tournament ·
#          prize pool · ranking
#
# Run from the repository root. Exits non-zero, and prints every hit, if anything
# matches. See CONTRIBUTING.md → "The language gate" for the exclusion rationale.
#
# Known limit: grep is line-based, so a banned PHRASE hard-wrapped across two
# lines of prose escapes it ("skill\ntournament" did exactly this once).
# Reviewers watch for wrapped phrases in markdown; single banned WORDS cannot
# wrap and are always caught.
#
# This script runs as the `standing-rules` CI lane on every PR (roadmap §3
# standing rule 4), alongside scripts/check-standing-rules.sh.

set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# The pattern also catches vocabulary that is not in §8.7 but belongs to the
# predecessor's product and has no business here: its name, its mechanics, and its
# marketplace.
# 2026-09-08: three holes closed, all found by testing the gate against its own
# word list rather than by reading it.
#
#   1. TWO WORDS WERE NEVER ENFORCED. CLAUDE.md and PID §8.7 forbid `deal` and
#      `gamble`. `deal` did not appear in this pattern at all, and `gamble` was
#      present only as the literal `gambling` — so `gamble`, `gambles` and
#      `gambled` all passed. Both now covered; both had ZERO hits in the tree,
#      so nothing was hiding behind them, but nothing was stopping them either.
#   2. EVERY \b...\b TERM ESCAPED ITS OWN PLURAL. `\bpack\b` does not match
#      `packs`: the trailing \b needs a non-word character and `s` is a word
#      character. Same for `bets`, `pulls`, `rolls`, `dealing`. A banned word
#      only had to be pluralised to ship.
#   3. COMPOUNDS ESCAPED TOO. `pack_open` (underscore is a word character) and
#      `PackOpened` (grep -i cannot distinguish a CamelCase seam) both passed.
#      Both are predecessor product identifiers — precisely the failure mode
#      the header above says this gate exists to catch.
#
# The inflections are enumerated rather than globbed. `\bpack\w*` would flag
# `packet` and `package`, and this repository has a `backend/packet/` service —
# a gate that cries wolf gets exclusions bolted onto it until it means nothing.
# `pack(s|ed|ing)` matches the banned forms and leaves `packet`/`package` alone.
PATTERN='casino|gambl|disguised|dopamine|shill|degen|the house|pump|bonding|lottery|jackpot|\bodds\b|\bpack(s|ed|ing)?\b|\bpack[_-]|\bpull(s|ed|ing)?\b|\bbet(s|ting|ted)?\b|wager|rake|\broll(s|ed|ing)?\b|\broll[_-]|\bdeal(s|t|ing)?\b|anarchy|\bxp\b|graduat|trending|magic eden|synthetic|promotion|sweepstake'

# CamelCase compounds, matched CASE-SENSITIVELY because the main sweep runs
# `grep -i` and so cannot see the seam between `Pack` and `Opened`. Kept as a
# separate pattern for exactly that reason: it is the one check here that must
# NOT be case-insensitive.
PATTERN_CAMEL='\b(Pack|Roll|Pull|Bet|Deal|Odds|Rake|Wager|Gambl|Lotter|Jackpot|Casino)[A-Z]|[a-z]Xp\b'

# D-B7 (ratified 2026-08-27): the amended lexicon. Five further groups, each a
# distinct failure mode. Public copy describes MECHANICS instead — "sealed-
# allocation tournament", "prizes paid by published rank", "randomness from
# Switchboard VRF affects the class draw only", "funds held by program <ID>;
# upgrades require <n-of-m> signatures".
#
#   1. Bare claims that assert a legal or trust status the product does not
#      hold or cannot prove in the sentence that makes the claim:
#      non-custodial · provably fair · licensed · regulated · compliant ·
#      trustless · can't be rigged · rig-proof
#   2. Anonymity-marketing: anonymous · anonymity · no-KYC · untraceable ·
#      unbannable · play from anywhere
#   3. Guarantee claims: guaranteed · risk-free · free money · +EV ·
#      everyone wins
#   4. Finance framing: yield · APY · passive income · earn · investment ·
#      early investors · number go up
#   5. Category assertions in public copy: not gambling ("gambling" is already
#      banned above) · just a game · skill game · skill tournament — plus the
#      internal-intent tell "gambling-coded" (also covered above).
PATTERN_B7='non.custodial|provably fair|\blicensed\b|\bregulated\b|\bcompliant\b|trustless|can.?t be rigged|cannot be rigged|rig.proof|\banonymous\b|\banonymity\b|no[- ]kyc|untraceable|unbannable|play from anywhere|\bguaranteed\b|risk.free|free money|\+ev\b|everyone wins|\byield\b|\bapy\b|passive income|\bearn(s|ed|ing)?\b|\binvestments?\b|early investors|number go up|just a game|skill games?\b|skill tournaments?\b|\breinvest|asset.managers?|\bamm\b|\badvis(e|es|ed|ing)\b'

# D3 (master prompt v3, 2026-08-27): retention runs on mastery and standing,
# never on pressure or chance-flavoured framing. These words are the
# do-not-build list's vocabulary; their presence in copy or code means a
# forbidden mechanic is being built. (jackpot and \broll\b are already in
# PATTERN above.)
PATTERN_D3='\bhurry\b|last chance|don.?t miss|\bstreaks?\b|daily bonus(es)?|\bspin(s|ning)?\b|\blucky\b'

# ---------------------------------------------------------------------------
# Exclusions. Each one has a reason; do not extend this list without the same
# scrutiny, and never exclude a path merely because it fails.
# ---------------------------------------------------------------------------
hits="$(
  grep -rniE "($PATTERN|$PATTERN_B7|$PATTERN_D3)" . \
    --exclude-dir=node_modules \
    --exclude-dir=target \
    --exclude-dir=.git \
    --exclude-dir=.next \
    `# Historical by definition — docs/README.md says so, and it is marked` \
    `# non-authoritative in its own header.` \
    --exclude-dir=archive \
    `# The founder's design-handoff folder (untracked; .gitignore keeps it out` \
    `# of the history, so CI never sees it — this guard is for local runs).` \
    `# Same category as the source documents below: an INPUT to the repo, not` \
    `# content authored in it, and its brief and design notes necessarily` \
    `# QUOTE the banned vocabulary in order to ban it.` \
    --exclude-dir=handoff \
    `# The brief for counsel (docs/counsel-brief/). A document whose purpose` \
    `# is to put the statutory tests in front of a lawyer cannot avoid the` \
    `# statutory words, exactly as PID 8.7 cannot. It is dated, is quoted on` \
    `# no player-facing surface, and docs/README.md says so.` \
    --exclude-dir=counsel-brief \
    `# These quote the forbidden list in order to forbid it — CONTRIBUTING` \
    `# and CLAUDE.md state the rule; the D-B7 step report documents which` \
    `# words were amended and to what. No other report gets this exclusion.` \
    --exclude=CONTRIBUTING.md \
    --exclude=CLAUDE.md \
    --exclude=step-vocabulary.md \
    --exclude=check-language.sh \
    `# The verbatim Apache-2.0 text ("Licensed under..."). Legal boilerplate` \
    `# nobody here authored; software licensing, not a gaming-licence claim.` \
    --exclude=LICENSE \
    `# The same category, added 2026-09-22: the SIL Open Font License 1.1 text` \
    `# shipped beside each self-hosted font in app/src/fonts. It trips \`licensed\`` \
    `# on its own third line -- "This Font Software is licensed under the SIL` \
    `# Open Font License". We are not merely allowed to ship this text, the OFL` \
    `# REQUIRES it, verbatim, with every copy of the font; rewording it to pass` \
    `# a grep would breach the licence the file exists to satisfy. Nobody here` \
    `# authored a word of it, and like LICENSE above it is software licensing,` \
    `# not a claim that this operator holds a gaming licence. Scoped to the` \
    `# suffix so it covers only these vendored texts and nothing we write.` \
    --exclude='*.OFL.txt' \
    `# Added 2026-09-30: Gradle's own wrapper scripts, vendored verbatim into` \
    `# the generated Android project (mobile/blotto-cup/, docs/guide/MOBILE.md).` \
    `# They carry the Apache-2.0 header ("Licensed under...", as LICENSE above)` \
    `# and Gradle's internal comments ("POSIX-compliant shell", "packing`  \
    `# multiple parameters", "Roll the args list"). Nobody here authored a word;` \
    `# editing them would fork a build tool to pass a grep, and a regenerated` \
    `# project would bring the originals back. Scoped to the two exact names.` \
    --exclude=gradlew \
    --exclude=gradlew.bat \
    `# Lockfiles are dependency metadata, not authored prose. Package names like` \
    `# "pump", "escape-string-regexp" and "solana-program-pack" are not ours to` \
    `# rename, and a lockfile is machine-generated.` \
    --exclude=Cargo.lock \
    --exclude=package-lock.json \
    --exclude=yarn.lock \
    `# Machine-generated compiler state (a file-list cache); same category as` \
    `# a lockfile. Never authored, never shipped.` \
    --exclude='*.tsbuildinfo' \
    `# Machine-generated transaction logs from the compiled program (base64` \
    `# event payloads) — regenerated by tests/litesvm/tests/dump_events.rs.` \
    `# Random keypair bytes can encode ANY substring; not authored prose.` \
    --exclude=lifecycle-logs.json \
    `# Binary assets (program-binary fixture, screen mockup PNGs): grep can` \
    `# match arbitrary byte sequences inside compressed data. Not prose.` \
    --exclude='*.png' \
    --exclude='*.so' \
    2>/dev/null \
  | grep -vE '^\./\.github/workflows/[^:]*:[0-9]+: *pull_request:?$'
)"

# The CamelCase sweep: same exclusions, no -i. Appended to the same `hits` so
# one report covers both and the exit status stays a single decision.
camel_hits="$(
  grep -rnE "$PATTERN_CAMEL" . \
    --exclude-dir=node_modules --exclude-dir=target --exclude-dir=.git \
    --exclude-dir=.next --exclude-dir=archive \
    --exclude-dir=handoff --exclude-dir=counsel-brief \
    --exclude=CONTRIBUTING.md --exclude=CLAUDE.md \
    --exclude=step-vocabulary.md --exclude=check-language.sh \
    --exclude=LICENSE --exclude=Cargo.lock --exclude=package-lock.json \
    --exclude=yarn.lock --exclude='*.tsbuildinfo' \
    --exclude=lifecycle-logs.json --exclude='*.png' --exclude='*.so' \
    2>/dev/null
)"
if [ -n "$camel_hits" ]; then
  hits="${hits:+$hits$'\n'}$camel_hits"
fi
#           ^ The ONE allowlisted token: `pull_request` is a GitHub Actions event
#             name. It cannot be renamed and it is not product language. Workflow
#             steps use `git fetch`, never `git pull`, so the verb never appears.
#             Nothing else is allowlisted.

# ---------------------------------------------------------------------------
# Self-test. The gate proves it can still catch what it claims to catch.
#
# Added 2026-09-08, because on that date this script had been reporting "clean"
# while `deal` was absent from its pattern entirely, `gamble` was covered only
# as the literal `gambling`, and every bounded word let its own plural through.
# A gate that is never tested degrades in silence, and this one is a
# legal-position control (compliance item C12) rather than a style check — so
# when it stops working it must say so, not report a clean tree.
#
# Each probe goes through the SAME patterns the sweep uses.
# ---------------------------------------------------------------------------
selftest_failures=""
for probe in \
  lottery gamble gambles gambled gambling \
  bet bets betting wager wagers \
  casino pull pulls pulled pulling \
  pack packs packed packing pack_open \
  odds jackpot rake \
  deal deals dealt dealing \
  roll rolls rolled rolling roll_open \
  xp XP
do
  if ! printf '%s' "$probe" | grep -qiE "($PATTERN|$PATTERN_B7|$PATTERN_D3)"; then
    selftest_failures="${selftest_failures}${selftest_failures:+, }$probe"
  fi
done

# CamelCase probes go to the case-SENSITIVE pattern.
for probe in PackOpened RollCalled PullRequested BetPlaced DealClosed playerXp; do
  if ! printf '%s' "$probe" | grep -qE "$PATTERN_CAMEL"; then
    selftest_failures="${selftest_failures}${selftest_failures:+, }$probe"
  fi
done

# And the words that MUST NOT trip it. A gate that flags `packet` gets
# exclusions bolted onto it until it means nothing, and this repository ships a
# `backend/packet/` service — so this is a live constraint, not a hypothetical.
for safe in packet packets package packages rollback payroll better between \
  RegExp regexp expiry export; do
  if printf '%s' "$safe" | grep -qiE "($PATTERN|$PATTERN_B7|$PATTERN_D3)"; then
    selftest_failures="${selftest_failures}${selftest_failures:+, }FALSE-POSITIVE:$safe"
  fi
  # The CamelCase sweep is a second way to flag the same word, so the
  # must-not-trip list has to clear that pattern too. `RegExp` is why: the
  # `xp` rule shipped without a leading word boundary and matched it, so a
  # test that scanned source with a built pattern failed CI on its own
  # identifier (2026-09-08).
  if printf '%s' "$safe" | grep -qE "$PATTERN_CAMEL"; then
    selftest_failures="${selftest_failures}${selftest_failures:+, }FALSE-POSITIVE-CAMEL:$safe"
  fi
done

if [ -n "$selftest_failures" ]; then
  echo "language gate: BROKEN — the gate itself failed its self-test."
  echo
  echo "Handled wrongly: $selftest_failures"
  echo
  echo "A probe that is not caught means the pattern no longer enforces a word"
  echo "PID 8.7 forbids. A FALSE-POSITIVE means it flags ordinary vocabulary and"
  echo "will collect exclusions until it means nothing. Fix the pattern; never"
  echo "delete the probe."
  exit 2
fi

if [ -n "$hits" ]; then
  echo "language gate: FAILED — PID §8.7 forbids this vocabulary."
  echo
  echo "$hits"
  echo
  echo "Rewrite the hits above. If one is genuinely unavoidable, say why in the"
  echo "change and raise it — do not widen the exclusion list to make it pass."
  exit 1
fi

echo "language gate: clean (self-test passed)"
