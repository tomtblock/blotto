/**
 * Prize amounts (roadmap 2.1; PID §6 as derived in
 * programs/blotto_cup/src/constants.rs).
 *
 * Bands are exact 1024ths of the pot, NOT the PID's rounded percentage
 * column (which sums to 100.02% and would misallocate — the on-chain crate
 * pins this with a test, and so does this module). The pot of every
 * configured tier is a multiple of 1024 lamports, so every division here is
 * exact with zero residual.
 *
 * All lamport arithmetic is BIGINT. A prize amount must never pass through a
 * JavaScript number: lamport values exceed 2^53 at the upper tiers and a
 * float-rounded prize is a payment bug.
 */

export const CAPACITY = 64n;

/**
 * The seven configured entry prices (D1, ratified 2026-08-27), tier 0..6 —
 * a TS mirror of `programs/blotto_cup/src/constants.rs::TIER_ENTRY_LAMPORTS`.
 * The Rust table is authoritative; this mirror is pinned to the Python
 * oracle's per-tier tables (vectors.json `tier_tables`) by the vector suite,
 * so drift fails tests rather than shipping. Rules-page and prize-table UI
 * derive every displayed number from THIS table — never hand-typed.
 */
export const TIER_ENTRY_LAMPORTS: readonly bigint[] = [
  100_000_000n,
  500_000_000n,
  750_000_000n,
  1_000_000_000n,
  2_500_000_000n,
  5_000_000_000n,
  7_500_000_000n,
];

/**
 * The seven FIXED pots (D-A1 revised, master prompt v2 2026-08-27), tier
 * 0..6 — a TS mirror of `constants.rs::TIER_POT_LAMPORTS`. A pot is a
 * CONSTANT funded from the prize treasury at `open_pool`, before any pass
 * is sold — never arithmetic over entries or balances. The founder's stated
 * derivation for these values is 62.5% of price × 64 (D-E1, 2026-09-06 —
 * equivalently price / 8 × 5 × 64, exact in integers); the derivation
 * is history, the constant is the law (the standing-rules grep bans pot
 * arithmetic in the program, and this module carries no 80/20 helpers any
 * more). Every value is a multiple of 1024 so the band table divides with
 * zero residue.
 */
export const TIER_POT_LAMPORTS: readonly bigint[] = [
  4_000_000_000n,
  20_000_000_000n,
  30_000_000_000n,
  40_000_000_000n,
  100_000_000_000n,
  200_000_000_000n,
  300_000_000_000n,
];

export const PAID_RANKS = 16;

/** Rank 1 → rank 16, in 1024ths of the pot. Sums to exactly 1024. */
export const PRIZE_BANDS_1024: readonly bigint[] = [
  270n, 158n, 102n, 78n, 50n, 50n, 50n, 50n, 27n, 27n, 27n, 27n, 27n, 27n, 27n, 27n,
];

/**
 * The LAUNCH-TABLE pot for a tier (D-A1 revised). Settlement code must not
 * use this against live chain state — the pool's own `pot_lamports` (copied
 * on-chain at open) is authoritative there, because the founder can change a
 * tier's economics between pools. This lookup exists for the rules page,
 * fixtures and tests, which speak about the published launch table.
 */
export function potForTier(tier: number): bigint {
  const pot = TIER_POT_LAMPORTS[tier];
  if (pot === undefined) throw new Error(`unknown tier ${tier}`);
  return pot;
}

/**
 * Launch-table lookup by entry price (for fixtures keyed on
 * `entry_lamports`). A LOOKUP into the published table, not arithmetic —
 * an unknown price throws rather than deriving anything.
 */
export function potForEntry(entryLamports: bigint): bigint {
  const tier = TIER_ENTRY_LAMPORTS.indexOf(entryLamports);
  if (tier === -1) throw new Error(`no tier with entry price ${entryLamports}`);
  return TIER_POT_LAMPORTS[tier];
}

/**
 * The prize for `rank` (1-based). Ranks 17..64 are real ranks with zero
 * prize — they appear in the results tree with amount 0.
 */
export function amountForRank(pot: bigint, rank: number): bigint {
  if (!Number.isInteger(rank) || rank < 1) {
    throw new Error(`rank must be a positive integer, got ${rank}`);
  }
  if (rank > PAID_RANKS) return 0n;
  return (pot * PRIZE_BANDS_1024[rank - 1]) / 1024n;
}
