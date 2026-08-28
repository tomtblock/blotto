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
PATTERN='casino|gambling|disguised|dopamine|shill|degen|the house|pump|bonding|lottery|jackpot|\bodds\b|\bpack\b|\bpull\b|\bbet\b|wager|rake|\broll\b|anarchy|xp\b|graduat|trending|magic eden|synthetic|promotion|sweepstake'

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
    `# Third-party agent skills installed by "npx skills add" (gitignored,` \
    `# never committed or shipped). Same category as node_modules: tooling` \
    `# dependencies not authored in this repository. The UI constitution` \
    `# requires them at build time; their prose is theirs, not ours.` \
    --exclude-dir=.agents \
    --exclude-dir=.claude \
    --exclude=skills-lock.json \
    `# Historical by definition — docs/INDEX.md says so, and both are marked` \
    `# non-authoritative in their own headers.` \
    --exclude-dir=reference \
    --exclude-dir=archive \
    `# The four source documents, copied verbatim. They are inputs to this` \
    `# repository rather than content authored in it, and PID §8.7 necessarily` \
    `# LISTS the words it forbids.` \
    --exclude=PID_Blotto-Cup_v0.5.md \
    --exclude=TECH-ARCHITECTURE_Blotto-Cup_v0.2.md \
    --exclude=REPO-EXTRACTION-BRIEF_v1.1.md \
    --exclude=REPO-TRANSITION-PLAYBOOK.md \
    --exclude=BUILD-ROADMAP_v1.0.md \
    `# The Phase 0 reports have to name the old product and the components that` \
    `# were not carried in order to be useful.` \
    --exclude=EXTRACTION-REPORT.md \
    --exclude=TRANSITION-REPORT.md \
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
#           ^ The ONE allowlisted token: `pull_request` is a GitHub Actions event
#             name. It cannot be renamed and it is not product language. Workflow
#             steps use `git fetch`, never `git pull`, so the verb never appears.
#             Nothing else is allowlisted.

if [ -n "$hits" ]; then
  echo "language gate: FAILED — PID §8.7 forbids this vocabulary."
  echo
  echo "$hits"
  echo
  echo "Rewrite the hits above. If one is genuinely unavoidable, say why in the"
  echo "change and raise it — do not widen the exclusion list to make it pass."
  exit 1
fi

echo "language gate: clean"
