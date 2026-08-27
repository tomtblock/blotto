# Step report — vocabulary review and amendment (`step/b7-vocabulary`, D-B7)

**Status: delivered.** Item B7 of the 2026-08-27 master build prompt. The
language gate now enforces the merged prohibited lexicon, every existing hit
in the repository is amended, and the stranded handover refresh is folded in.

**Stacks on B6** (`step/b6-rules-tab`); also merges `main` (the A2 and B3
merges) so the review ran over the whole current tree, the skill-evidence
artifacts included.

## What was built

- **The extended gate** (`scripts/check-language.sh`): a second pattern,
  `PATTERN_B7`, combined with the existing PID §8.7 pattern in the same
  grep. Five groups, each documented in the script and in
  `CONTRIBUTING.md` → "The language gate":
  1. bare status claims — non-custodial · provably fair · licensed ·
     regulated · compliant · trustless · can't/cannot be rigged · rig-proof;
  2. anonymity-marketing — anonymous · anonymity · no-KYC · untraceable ·
     unbannable · play from anywhere;
  3. guarantee claims — guaranteed · risk-free · free money · +EV ·
     everyone wins;
  4. finance framing — yield · APY · passive income · earn(s/ed/ing) ·
     investment(s) · early investors · number go up;
  5. public-copy category assertions — just a game · skill game(s) · skill
     tournament(s); "not gambling" and "gambling-coded" were already caught
     by the base pattern's `gambling`.
- **One new exclusion**: `LICENSE` — the verbatim Apache-2.0 text contains
  "Licensed under"; legal boilerplate nobody here authored, software
  licensing rather than a gaming-licence claim. Nothing else was excluded
  and nothing was allowlisted.
- **Fourteen hits amended** — every one a rewrite to state the mechanism,
  never a widened exclusion:
  - `trustless` ×5 → "operator-independent" (`state.rs`, `register.rs`),
    "self-funding" (`refund.rs`), "permanent by construction" (`pass.rs`),
    "needs no operator" (`phase-1-program.md`);
  - `no KYC` ×4 → "the KYC-at-claim switch starts off at launch"
    (`admin.rs`), "KYC stays off at launch" (`service.ts`), "neither a KYC
    provider nor an age-verification vendor" (`attestations.ts`), "without
    a KYC provider" (`step-age-clickwrap.md`);
  - `skill tournaments` in the age-attestation checkbox
    (`app/src/copy/index.ts`) → "entering a paid tournament for prizes" —
    the category assertion the master prompt named, replaced with the
    mechanical description;
  - `earn` ×2 → "score 0 zones" (`missing.ts`), "passes its gate"
    (`docs/INDEX.md`);
  - `anonymous` (Docker volume comment, `postgres.sh`) → "unnamed scratch
    storage";
  - `Licensed` in `LICENSE` → the exclusion above;
  - `skill tournament` in `docs/HANDOVER.md`, hard-wrapped across two
    lines → "sealed-allocation tournament" (see judgement call 2).
- **The stranded handover refresh** (commit `1804fd0` from the old
  extraction branch) is cherry-picked in, then amended by the review like
  everything else.

## Judgement calls

1. **Whole words and phrases, not stems.** `\bearn(s|ed|ing)?\b` catches the
   claim and leaves "learn"/"earnest" alone; `no[- ]kyc` catches the
   marketing phrase and leaves the `kyc_tier` field and "without a KYC
   provider" alone; `\blicensed\b` stays banned in authored prose while the
   verbatim Apache text is excluded by file. The gate stays case-insensitive
   throughout, so `APY`/`+EV` are caught in any casing.
2. **The gate is line-based and a wrapped phrase can escape it** — the
   handover's "skill \n tournament" proved it. Catching that mechanically
   needs multiline tooling the repo doesn't carry; documented as a known
   limit in the script header and CONTRIBUTING instead, with reviewers
   watching wrapped prose. Single banned words cannot wrap and are always
   caught.
3. **Internal comments are held to the same lexicon as public copy.** "No
   KYC at launch" in a Rust comment was policy description, not marketing —
   but the gate cannot tell the difference, and a grep with a
   "comments-are-fine" carve-out is no gate at all. All rewrites read at
   least as precisely as what they replaced.
4. **The user-facing checkbox line changed** ("skill tournaments" → "a paid
   tournament"). User-facing language is founder-owned; this specific
   amendment was named in the master prompt, so it is ratified — but the
   canonical signed attestation message (`attestation-message.ts`) is
   untouched, so no terms-version bump is needed: what wallets sign is
   byte-identical.

## Tests

- Gate self-test: 31 banned words/phrases each planted in a scratch file
  and caught; 7 legitimate near-misses ("learn", "in earnest", "therapy",
  "KYC tier stays zero", "the license field", "guarantee of conservation",
  "without a KYC provider") each pass. Run manually for this step; the
  planted-file harness is not committed (the gate scans the tree, so a
  committed fixture of banned words would defeat it).
- Full suites re-run after the amendments: Rust fmt + clippy `-D warnings`
  + workspace tests green; app 155 vitest + lint + typecheck; packet 37
  mocha; reveal 8 mocha; language gate, standing-rules gate and the
  CI-equivalent gitleaks tree scan all clean, before and after merging
  `main` in.

## For the founder

- The full amended word list lives in one place for humans
  (`CONTRIBUTING.md` → "The language gate") and one place for the machine
  (`scripts/check-language.sh`); `docs/INDEX.md` points at both. Adding a
  word later is a one-line change to the script plus its CONTRIBUTING row.
- The rules tab, custody page and all future copy are written against this
  lexicon from the start; the gate fails CI on any regression.
