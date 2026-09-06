# Step report — tiers and ties (`step/tiers-and-ties`)

**Status: executed in full.** D1, D2 and D3-B were ratified by the founder on
2026-08-27 ("Ok make all the changes that are still open"), recorded as rows
D1 / D2 / D3-B in the roadmap's decision register (`docs/BUILD-ROADMAP_v1.0.md`
§1.2). Part 3 (documenting the pre-D3 tie order) had already been delivered
under the stop-and-ask protocol; D3-B supersedes it and this report replaces
that interim report.

## What was ratified

- **D1 — seven concurrent tiers.** Entry prices 0.1 / 0.5 / 0.75 / 1 / 2.5 /
  5 / 7.5 SOL; at most one Open pool per tier (R14 held per-tier); only the
  0.1 tier open at launch. Tiers 2–6 stay gated by R6 (audit + counsel before
  0.5 SOL and above); the KYC-at-claim switch is expected ON before any tier
  whose 1st-place share exceeds the founder's threshold.
- **D2 — per-tier vault ceilings on GROSS intake**, checked at `open_pool`
  only: tier 0 at 6.4 SOL, every other tier at its own gross (entry × 64).
  Lowering a ceiling never affects an open pool — it blocks the next open.
  `set_vault_ceiling` moves one tier per call (Squads proposal readability).
- **D3-B — split-pot ties.** The definition, verbatim from the ratified
  prompt's §5.1 and implemented everywhere:

  > Two players are TIED when their score AND zones are equal. Tied players
  > share a competition rank (1, 2, 2, 4 — one plus the number of strictly
  > better players). A tie group at rank r of size s occupies positions
  > r..r+s-1; its combined prize is the sum of the band amounts of those
  > positions that are ≤ 16 (positions past the table pay zero). Each member
  > takes floor(combined / s); the indivisible lamport remainder goes to the
  > group's lowest entry index. Every tied member with a nonzero share is
  > paid — the paid set can exceed 16 seats. Entry index never decides who
  > is paid or who ranks above whom; it only places the remainder and fixes
  > the published Merkle leaf order: **(rank asc, entry index asc)** — ranks
  > repeat under shared competition ranks, so the index breaks the order.
  > The leaf stays `sha256(0x00 ‖ player ‖ rank u8 ‖ amount u64 LE)`.

## Per-tier prize and ceiling tables

Pot = entry × 0.8 × 64 = 51.2 × entry. Bands are exact 1024ths
(270/158/102/78/50×4/27×8); every configured entry is a multiple of 20
lamports so each division is exact with zero residual.

| Tier | Entry | Gross (×64) | Launch ceiling (D2) | Pot (80%) | 1st | 2nd | 3rd | 4th | 5th–8th | 9th–16th |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 0.1 | 6.4 | **6.4** | 5.12 | 1.35 | 0.79 | 0.51 | 0.39 | 0.25 | 0.135 |
| 1 | 0.5 | 32 | 32 | 25.6 | 6.75 | 3.95 | 2.55 | 1.95 | 1.25 | 0.675 |
| 2 | 0.75 | 48 | 48 | 38.4 | 10.125 | 5.925 | 3.825 | 2.925 | 1.875 | 1.0125 |
| 3 | 1 | 64 | 64 | 51.2 | 13.5 | 7.9 | 5.1 | 3.9 | 2.5 | 1.35 |
| 4 | 2.5 | 160 | 160 | 128 | 33.75 | 19.75 | 12.75 | 9.75 | 6.25 | 3.375 |
| 5 | 5 | 320 | 320 | 256 | 67.5 | 39.5 | 25.5 | 19.5 | 12.5 | 6.75 |
| 6 | 7.5 | 480 | 480 | 384 | 101.25 | 59.25 | 38.25 | 29.25 | 18.75 | 10.125 |

All values SOL. The tier-2 and tier-6 columns are asserted to the lamport by
`tests/litesvm/tests/tiers_and_ties.rs` against the compiled artifact, and
per-tier band tables for all seven tiers are Python-oracle-pinned in
`backend/scoring/fixtures/vectors.json` (`tier_tables`).

## Config: no migration needed

No credentialed deploy has happened (TRANSITION-REPORT.md); no on-chain
`Config` account exists, so the layout change (arrays widened 4 → 7, ceilings
per tier) ships without a migration path. The devnet `solana account` check
runs at first deploy. The indexer's derived tables ARE rebuilt: migration
`backend/_shared/migrations/0004_seat_payouts.sql` drops and re-keys
`results`/`payouts` (pool, seat) and requires a `rederive()` — safe because
derived tables are a pure function of the events ledger (0003's contract).

## What changed, file by file

### On-chain program (`programs/blotto_cup/`)

- `src/constants.rs` — `N_TIERS = 7`; `TIER_ENTRY_LAMPORTS` per D1.
- `src/state.rs` — `Config`: `open_tiers: [bool; N_TIERS]`,
  `vault_ceiling_lamports: [u64; N_TIERS]`, `active_pool_by_tier: [u64; N_TIERS]`
  (LEN 266). New `Payout { entry_index: u16, amount: u64 }`. `Pool`: the
  `winners: [Pubkey; 16]` + u16 mask fields are replaced by
  `payouts_len: u16` + `payouts: [Payout; 64]` + `paid_mask: u64`
  (LEN 832, SPACE 840 — measured by the serialize-LEN tests).
- `src/instructions/admin.rs` — `handle_init_config(…, vault_ceiling_lamports:
  [u64; N_TIERS])` (was a single ceiling); launch `open_tiers =
  [true, false × 6]`; new `handle_set_vault_ceiling(ctx, tier: u8,
  ceiling_lamports: u64)` (was a single global value).
- `src/instructions/open_pool.rs` — D2 gate: `gross = entry × 64 ≤
  vault_ceiling_lamports[tier]`, checked at open only.
- `src/prize_math.rs` — new `split_group(pot, first_rank, group_size) →
  (each, remainder)` + conservation tests (the 4th–6th three-way remainder,
  the 16/17 straddle, 17+ → zero, the 64-way split).
- `src/instructions/reveal_commit.rs` — `handle_commit_results(ctx, pool_id,
  root, payouts: Vec<Payout>)` (was `winners: [Pubkey; 16]`): rejects empty
  or oversized lists, out-of-range seats, non-strictly-ascending seats
  (sorted + duplicate-free in one check), and any amount sum ≠ pot.
- `src/instructions/pay_prizes.rs` — `handle_pay_prizes(ctx, pool_id,
  seats: Vec<u16>)` (was `ranks: Vec<u8>`): binary-search into the committed
  list (`SeatNotInPayouts` otherwise); `paid_mask` bit = seat; the Entry
  account is the on-chain seat→player map (`entry.index == seat`,
  `wallet == entry.player`); `Paid` when every COMMITTED seat's bit is set.
- `src/error.rs` — `PayoutListMalformed` (6043), `PayoutSumMismatch` (6044),
  `SeatNotInPayouts` (6045).
- `src/events.rs` — `ResultsCommitted { pool, root, payouts: Vec<Payout> }`;
  `PayoutRecord { player, entry_index: u16, amount, escrowed }`;
  `PrizesPaid.paid_mask: u64`.
- Every `Accounts` context boxes `Pool`/`Entry`/`Config` (`Box<Account<…>>`)
  — the larger Pool overflowed the 4 KiB SBF stack otherwise.
- `src/lib.rs` — signatures updated accordingly.

### Tests (Rust)

- `programs/blotto_cup/tests/vault_model.rs` — the model commits a seeded
  tie-group ranking through the shared `split_group` and settles by seat;
  conservation re-checked across 10k proptest sequences.
- `tests/litesvm/` — harness encodes the new args/offsets; `gates.rs` gains
  seven-pools-at-once + eighth-open-rejects and ceiling-lowering tests and
  the malformed-payout-list rejections; new `tiers_and_ties.rs` settles a
  0.75 and a 7.5 pool to the table above (vault exactly zero) and a tie-case
  pool (18-seat paid set straddling position 17, remainder visible);
  `dump_events.rs` regenerates the cross-language fixture. 19 tests, green.

### Off-chain (TypeScript + Python oracle)

- `backend/scoring/src/engine.ts` — `scorePool` assigns shared competition
  ranks; `PlayerResult` gains `amountLamports: bigint`; new
  `assignPrizes(results, pot)` implements the split with an internal
  conservation assertion; `rankOrder` = leaf order (rank asc, index asc).
- `backend/scoring/fixtures/gen_vectors.py` — the oracle implements the same
  ranks + split; regenerated `vectors.json` adds `split_cases` (two-way tie
  for 1st; three-way 4th–6th with the 2-lamport remainder; the 16/17
  straddle paying 17 seats; the 64-way split), `tier_tables` (all seven
  tiers), per-tier 64-player pool vectors, and a 64-player all-identical
  pool (a real 64-way tie with a tree). 71 TS tests reproduce it all.
- `backend/reveal/` — `SettlementChain.commitResults` takes the payout list,
  `payPrizes` takes seats; `ChainPoolView.payouts` replaces `winners`,
  `paidMask` is a bigint; `FakeChain` mirrors the program's four commit
  checks and seat settlement; `Web3Chain` reads the new Pool offsets
  (payouts at 186, u64 mask at 826) and encodes the new args, resolving each
  seat's wallet from the Entry accounts; the crank builds the list via
  `assignPrizes`, publishes bundle `payouts` (replacing `winners`), and its
  resume-divergence check compares committed vs recomputed (seat, amount)
  lists; `missing.ts` gives missing entries a shared competition rank (they
  tie by construction).
- `backend/_shared/src/blotto-events.ts` — decoders for the three changed
  event layouts, verified against real Anchor-emitted bytes (the regenerated
  `lifecycle-logs.json`).
- `backend/indexer/` — projection keys `results` (seat → committed amount)
  and `payouts` (seat → player/amount/escrowed); the `min`/`best_rank` op is
  gone, `ranks_paid` → `seats_paid`; a new `paid_if_fully_settled` op sets
  the u64 mask (decimal string) and flips `Paid` when every committed seat's
  bit is set — in both the in-memory and Postgres executors; migration 0004.
- `app/` — verify page recomputes ranks + split amounts with the same
  `assignPrizes`, checks the committed payout list seat-for-seat and each
  settled payout against the seat's own wallet; results page is seat-keyed
  with the tie note; rules-page copy states the D3-B tie rule (SUBSTANCE
  FIXED); profile drops `best_rank`, shows `seats_paid`; the share card
  shows the prize amount instead of a rank label.
- `tests/rehearsal/` — orchestrator + specs on the payouts model.

## Judgement calls (all carry `// PHASE-N-REVIEW`-grade reasoning here)

1. **`Payout` carries no rank field.** Exactly `{entry_index, amount}`, per
   the prompt. Rank labels (and tie labels) are therefore NOT in events or
   the indexer — they live in the published bundle, where the verify page
   recomputes them. Consequences accepted: the results page shows seats and
   prizes without rank labels (a wrong tie label is worse than none —
   tradeoff order #3 over #5); the share card shows the prize amount; the
   profile's `best_rank` stat is dropped (`seats_paid` replaces
   `ranks_paid`). If the founder wants rank labels back in the app, the
   clean route is indexing the published bundle, not widening the on-chain
   struct.
2. **The committed list lives on the Pool account** (`Pool::LEN` 839, 847
   with the discriminator — 834 in the original text was the end offset of
   the payouts array, corrected 2026-09-06; well under the 10 KiB realloc
   threshold and one transaction on the wire: 64 × 10 bytes + root ≈ 700
   bytes).
3. **The Entry account is the seat→player map at payout.** `pay_prizes`
   binds wallet → `entry.player` and seat → `entry.index`, so the recipient
   cannot be substituted; the settlement signer only chooses batching.
4. **`Paid` = every committed seat settled** (not a full 64-bit mask): the
   paid set's size varies under D3-B.
5. **Indexer migration is drop + rederive** (0004): derived tables are a
   pure function of the ledger, so re-keying by seat costs one replay, no
   backfill.

## Trust structure: unchanged

Who is paid and how much is fixed at `commit_results`, validated on-chain
(sum = pot exactly, seats sorted and in range), and player-recomputable from
published data — the split-pot rule is deterministic integer arithmetic over
the published ranking. The settlement signer still chooses only batching.
The vault still has exactly four lamport exits (`pay_prizes`,
`release_escrow`, `refund`, `forfeit_escrow` — the prompt's "three exits"
phrasing predates the roadmap's own forfeit path; the CI grep asserts the
four-mover set). No new exit, no admin path, no float anywhere in money or
scoring (`u128` intermediates on-chain, bigint off-chain).

## Founder next steps

- Tiers 1–6 stay closed until you flip them (`set_open_tiers`), gated by R6.
- Before opening any tier whose 1st place exceeds your KYC threshold
  (founder-owned number, still unset), turn the KYC-at-claim switch on.
- The PID's §2/§6 tables still describe two tiers (0.1/0.5); D1's register
  row supersedes them until PID v0.6 — a PID edit is yours to make.
- The claim in `pool.prizeTableTitle` copy ("top 16 paid") is still true in
  the common case but under-describes ties; Phase 6's copy pass should
  align it with the tie note.
