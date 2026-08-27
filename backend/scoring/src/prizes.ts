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
export const VAULT_BPS = 8000n;
export const BPS_DENOM = 10000n;
export const PAID_RANKS = 16;

/** Rank 1 → rank 16, in 1024ths of the pot. Sums to exactly 1024. */
export const PRIZE_BANDS_1024: readonly bigint[] = [
  270n, 158n, 102n, 78n, 50n, 50n, 50n, 50n, 27n, 27n, 27n, 27n, 27n, 27n, 27n, 27n,
];

/** The 80% vault share of one entry. */
export function vaultShare(entryLamports: bigint): bigint {
  return (entryLamports * VAULT_BPS) / BPS_DENOM;
}

/** The pot of a sealed pool: 64 vault shares. */
export function potLamports(entryLamports: bigint): bigint {
  return vaultShare(entryLamports) * CAPACITY;
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
