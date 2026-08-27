# Step report — A2 (v2 amendments): homogeneous fields + player history

**Status: complete.** Master prompt v2 (2026-08-27) work item A2, one PR,
stacked on the A1 treasury PR. Suites green (rehearsal 8, indexer 30, all
others unchanged); the full study regenerated (200-pool mixed + 3 × 200
homogeneous ≈ 800 pools, 128s) and committed; nightly CI lane header
updated to the new scale.

## What the amendment delivers

1. **Within-class uniqueness.** No two entrants of one class in one pool
   share the identical seven-battle allocation set. The jitter model is
   documented at its site (one seeded transfer of ≤ jitterMax points
   between trio stats, sum pinned at 100); residual full-set collisions are
   repaired deterministically (`ensureUniqueWithinClass` regenerates the
   later entrant with a bumped salt). **Judgement call: the uniform class
   is exempt** — 20/20/20/20/20 every battle *is* the class; jittering it
   would destroy the structural property the appendix documents. Recorded
   in `tests/rehearsal/strategies/README.md` and asserted by a spec.
2. **Homogeneous-field runs.** 200 pools per class (random / heuristic /
   optimised) with all 64 seats one class. Measured result: every class
   lands the everyone-equal baseline exactly — mean payout share 1.5625%
   (1/64 of the pot, forced by conservation), rank-1 rate 1.562% ≈ 1/64.
   A homogeneous *uniform* run is refused by construction (it is a single
   64-way tie). Seed strides keep the four runs' pools disjoint.
3. **Report restructure + methodology.** The report now LEADS with the
   random-vs-optimised comparison (0.0041% vs 4.63% mean share in the
   regenerated run), moves uniform to an appendix with the
   loses-3–2-to-any-concentration explanation, and carries a full
   methodology section: seeds, definitions, composition, the uniqueness
   rule, the same-engine statement, and the repro command. The CSV gains a
   `run` column (`mixed` / `homogeneous`).
4. **Player history (the Gate 3 exhibit).** Migration
   `0008_player_history.sql`: one derived row per pool × player — tier,
   seat, `entries_to_date` (the profiles counter as of the entry's own
   event), paid, amount, the pool's fixed pot. Projected by a new named op
   (`history_on_entry`, cross-table like the two existing conditionals) in
   both executors; `rederive()` rebuilds it from the ledger alone. Read
   API: `GET /history/summary` (first-time vs repeat paid-seat rate),
   `GET /history/persistence` (paid rate at entry n+1 conditioned on the
   outcome at entry n, over consecutive-entry pairs), `GET
   /history/entries` (entries-per-wallet distribution). Wallet addresses
   are the only identifier anywhere in these rows.

## Judgement calls

- **"Rank persistence" is measured on PAID SEATS**, not rank labels: under
  D3-B ranks are not in the events (they live in the published bundle), so
  the on-chain-verifiable outcome is the committed paid seat. The
  persistence endpoint conditions on it; a skill mechanism separates the
  conditioned rates, a chance mechanism coincides them.
- An escrowed committed payout **counts as paid** in history rows — escrow
  is custody pending review, not a smaller prize.
- The regenerated mixed-run numbers differ slightly from the previous
  committed study: the uniqueness fixup alters any pool that previously
  contained a within-class duplicate set. The nightly lane diffs against
  the NEW artifacts; the old numbers remain in git history.
