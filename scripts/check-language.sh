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
# This script runs as the `standing-rules` CI lane on every PR (roadmap §3
# standing rule 4), alongside scripts/check-standing-rules.sh.

set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# The pattern also catches vocabulary that is not in §8.7 but belongs to the
# predecessor's product and has no business here: its name, its mechanics, and its
# marketplace.
PATTERN='casino|gambling|disguised|dopamine|shill|degen|the house|pump|bonding|lottery|jackpot|\bodds\b|\bpack\b|\bpull\b|\bbet\b|wager|rake|\broll\b|anarchy|xp\b|graduat|trending|magic eden|synthetic|promotion|sweepstake'

# ---------------------------------------------------------------------------
# Exclusions. Each one has a reason; do not extend this list without the same
# scrutiny, and never exclude a path merely because it fails.
# ---------------------------------------------------------------------------
hits="$(
  grep -rniE "$PATTERN" . \
    --exclude-dir=node_modules \
    --exclude-dir=target \
    --exclude-dir=.git \
    --exclude-dir=.next \
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
    `# These two quote the forbidden list in order to forbid it.` \
    --exclude=CONTRIBUTING.md \
    --exclude=CLAUDE.md \
    --exclude=check-language.sh \
    `# Lockfiles are dependency metadata, not authored prose. Package names like` \
    `# "pump", "escape-string-regexp" and "solana-program-pack" are not ours to` \
    `# rename, and a lockfile is machine-generated.` \
    --exclude=Cargo.lock \
    --exclude=package-lock.json \
    --exclude=yarn.lock \
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
