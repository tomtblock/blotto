/**
 * Prize amounts (roadmap 2.1; D-E2 winner-takes-all, ratified 2026-09-06,
 * as pinned in programs/blotto_cup/src/constants.rs).
 *
 * One paid place: the ranked-first player receives the whole pot. A tie for
 * first splits it exactly (D3-B's rule, unchanged — see `assignPrizes`).
 * The band table keeps its 1024ths shape so the pot's 1024-multiple
 * invariant and the on-chain tests still mean something; under D-E2 it has
 * one entry, 1024/1024. The sixteen-band table it replaces lives in git
 * history and on the revert branch.
 *
 * All lamport arithmetic is BIGINT. A prize amount must never pass through a
 * JavaScript number: lamport values exceed 2^53 at the upper tiers and a
 * float-rounded prize is a payment bug.
 */

export const CAPACITY = 64n;

/**
 * The smallest field that runs (D-E4, ratified 2026-09-06) — a TS mirror of
 * `constants.rs::MIN_SEATS`. A pool with at least this many entrants when
 * its deadline passes seals and plays; below it, the pool refunds. Break-
 * even is 40 seats at every tier (pot = price × 40), so 52 leaves twelve
 * seats of margin on the worst run. A seat count, never a percentage.
 */
export const MIN_SEATS = 52n;

/**
 * The fill deadline `open_pool` seeds into every new pool, in seconds — a
 * TS mirror of `constants.rs::DEFAULT_FILL_DEADLINE_SECS` (12 hours,
 * founder ruling 2026-09-07, superseding R7's 72 h). Since the same ruling
 * it lives in `Config.fill_deadline_seconds` (changeable by the admin's
 * `set_pool_timing`, never touching an open pool); this constant is the
 * launch value and what the rules page states. Option A: a pool seals at
 * the 64th seat or at this deadline with at least `MIN_SEATS`, and refunds
 * below — there is no second clock (the go-timer of the first cut is gone).
 */
export const DEFAULT_FILL_DEADLINE_SECS = 12n * 3600n;

/**
 * The per-tier cooldown after a pool settles (Paid or Closed) before the
 * tier's next pool may open — `constants.rs::DEFAULT_COOLDOWN_SECS`, seeded
 * into `Config.cooldown_seconds` (prompt v2 §B.6). The app's "next pool in"
 * countdown reads the on-chain `tier_next_open_at`, not this.
 */
export const DEFAULT_COOLDOWN_SECS = 5n * 60n;

/**
 * How long a tier may sit idle past its cooldown before ANY signer (not only
 * the keeper) may open its next pool — `constants.rs::LIVENESS_FALLBACK_SECS`
 * (prompt v2 §A.3). A dead daemon cannot freeze a tier.
 */
export const LIVENESS_FALLBACK_SECS = 24n * 3600n;

/**
 * How long after a share is escrowed anyone may release it to its player —
 * `constants.rs::ESCROW_AUTO_RELEASE_SECS` (prompt v2 §E.3): inaction pays
 * the player. An upheld flag (`forfeit_escrow`, admin-signed) closes this
 * door; the share is then paid to the next eligible place instead.
 */
export const ESCROW_AUTO_RELEASE_SECS = 7n * 24n * 3600n;

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

/** D-E2: one paid place. Mirrors `constants.rs::PAID_RANKS`. */
export const PAID_RANKS = 1;

/** Rank 1 → rank `PAID_RANKS`, in 1024ths of the pot. Sums to exactly 1024. */
export const PRIZE_BANDS_1024: readonly bigint[] = [1024n];

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
 * The prize for `rank` (1-based). Every rank past `PAID_RANKS` is a real
 * rank with zero prize — it appears in the results tree with amount 0.
 */
export function amountForRank(pot: bigint, rank: number): bigint {
  if (!Number.isInteger(rank) || rank < 1) {
    throw new Error(`rank must be a positive integer, got ${rank}`);
  }
  if (rank > PAID_RANKS) return 0n;
  return (pot * PRIZE_BANDS_1024[rank - 1]) / 1024n;
}
