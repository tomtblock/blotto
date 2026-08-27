# Step report — rules tab (`step/b6-rules-tab`, D-B6)

**Status: delivered.** Item B6 of the 2026-08-27 master build prompt.
Stacks on B4 (branch chain b3 → b4 → b6; the base retargets to `main` as the
predecessors merge).

## What was built

- **`app/src/app/rules/rules.config.ts`** — the tab's single data source.
  Every displayed number derives from the shared constants the prize path
  uses: `TIER_ENTRY_LAMPORTS` (new in `backend/scoring/src/prizes.ts`, a TS
  mirror of the program's D1 table, pinned to the Python oracle's
  `tier_tables` by the vector suite so drift fails tests), `potLamports`,
  `amountForRank`. Availability renders from the founder-owned
  `config/territories.json`; the terms version from `config/terms.json`.
  No hand-typed figures anywhere on the page.
- **The section set, in reading order** (one section per ratified topic):
  how to enter · price per tier (table) · prize pool and payout table
  (all seven tiers × 16 positions) · how scoring works (SUBSTANCE FIXED,
  incl. the R9 lock-current disclosure) · how ties are resolved (the D3-B
  rule verbatim in plain words, remainder to the earliest seat) · what
  randomness does and does not do (class draw only — the §8.4 scope,
  stated) · sealing (encrypted before payment, revealed at close) · refund
  and closing rule (72h, full refund incl. platform share) · how to verify
  (link to `/verify`) · availability (from `territories.json`) · 18+ ·
  playing responsibly.
- **`COPY.rules` rewritten** — the R4 skeleton (eight TODO_COPY stubs) is
  superseded by the full plain-language set. Everything mechanical is
  filled; no `TODO_COPY` remains on the rules tab (asserted by test). The
  substance-fixed paragraphs state exactly what the code enforces; Phase 6
  may re-phrase with substance intact.
- **The page** renders the sections with the two tables in their own
  horizontally scrollable containers.

## Judgement calls

1. **The tier table lives in `backend/scoring`, not the app** — the rules
   page, the pool pages and any future prize UI read one table, and the
   oracle pin makes it impossible to change the TS mirror without the
   vector suite noticing. The Rust constants remain authoritative.
2. **Availability is phrased as an allowed list** ("available only in…"),
   matching R2's allowlist posture; the blocked list renders additionally
   when non-empty. ISO codes map to display names; an unmapped code renders
   as the code, never silently dropped.
3. **The R4 "detection criteria" and "language audit" stub sections** from
   the old skeleton are not on the D-B6 tab (its ratified section list does
   not include them); C10 adds the review-process appendix, and detection
   criteria remain a founder/counsel Phase 6 item recorded in R4. Noted
   here so the omission is a decision, not a loss.

## Tests

- App: 6 new vitest specs — numbers derive from the shared constants (tier 0
  first prize 1.35 SOL, tier 6 first prize 101.25 SOL), all twelve sections
  present in order, no TODO_COPY, substance-fixed claims present,
  availability from config. 155 app tests total; typecheck, lint,
  production build clean.
- `backend/scoring` 72 specs including the new mirror pin.

## For the founder

The rules tab is live with mechanical truth filled in. Phase 6 remains
yours + counsel's for voice: re-phrase any paragraph freely; the
substance-fixed markers in `app/src/copy/index.ts` say which facts must
survive re-phrasing. The terms document itself (what the clickwrap
references) is still R4 founder/counsel prose.
