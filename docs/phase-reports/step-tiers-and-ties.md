# Step report — tiers and ties (`step/tiers-and-ties`)

**Status: Part 3 delivered; Parts 1, 2 and 4 are STOPPED awaiting D1–D3.**
The session prompt's §0 makes the founder's ticked checkbox the act of
ratification, and all three lines arrived unticked. Per that protocol the
unblocked part is done and the rest waits.

## Delivered — Part 3: the tie rule that exists today, documented

The rules page's "Identical-field scoring" section now states the engine's
ordering exactly, in plain words (`app/src/copy/index.ts`, marked
SUBSTANCE FIXED so the Phase 6 copy pass may re-phrase but never re-order):

> score (battles won, draws half) → total stats won across all comparisons →
> earlier seat.

"Seat" is entry order made strictly monotonic — two entries can share a
timestamp, never a seat (Phase 2 report, judgement call 3). The implementing
line is `backend/scoring/src/engine.ts`:

```ts
const order = [...Array(n).keys()].sort(
  (i, j) => scoreHalf[j] - scoreHalf[i] || zones[j] - zones[i] || i - j
);
```

Under D3-A this section is the whole of Parts 3/4.

## Verified in advance (so ratification can be immediate)

- **Pot arithmetic for the proposed D1 tiers** — checked, all agree with the
  prompt: pot = entry × 0.8 × 64; 0.75 SOL → pot 38.4, 1st 10.125;
  2.5 → 128, 1st 33.75; 5 → 256, 1st 67.5; 7.5 → 384, 1st 101.25.
- **1024ths divisibility** — pot = 51.2 × entry, so any entry that is a
  multiple of 20 lamports divides exactly; all seven proposed entries do.
- **No on-chain Config exists** — no credentialed deploy has happened
  (TRANSITION-REPORT.md), so the `Config` layout change in Part 1 needs no
  migration; the `solana account` not-found check runs when Part 1 executes.

## Corrections to carry into execution (prompt vs branch reality)

1. **The vault exit set is four movers, not three** — `pay_prizes`,
   `release_escrow`, `refund`, `forfeit_escrow` (the roadmap's own §1.4
   forfeit path; Phase 1 report; `vault.rs` header). The CI grep asserts
   exactly this set. Part 5.3's "three exits" language will be written as
   the four-mover set.
2. **Paths**: the copy module is `app/src/copy/index.ts` (not
   `app/src/copy.ts`); the indexer has event decoders and derived-table
   projections (`backend/_shared/src/blotto-events.ts`,
   `backend/indexer/src/projection.ts`) rather than a `Config` account
   decoder — the tier→entry mirror to consolidate lives in
   `app/src/data/format.ts` today.
3. **Scoring vectors** live in `backend/scoring/fixtures/` — per-tier pool
   vectors land there in Part 1 as instructed.

## Awaiting the founder

- [ ] **D1** — the seven-tier table (0.1 / 0.5 / 0.75 / 1 / 2.5 / 5 / 7.5).
- [ ] **D2** — per-tier vault ceilings (tier 0 = 6.4 SOL; others = own gross).
- [ ] **D3** — tie handling: **A** (keep today's deterministic order,
  documented above — zero further code) or **B** (split-pot; Part 5's
  program, engine, oracle and verify changes).

Tick the lines in the session prompt (or reply "D1 yes, D2 yes, D3-A/B")
and Parts 1–2 (and 4, under D3-B) execute in this branch.
