/**
 * The priority-fee choice, pure and shared (audit 2026-09-11, C-34).
 *
 * The browser's entry path has bid a priority fee since 10.B: the 75th
 * percentile of the non-zero `getRecentPrioritizationFees` samples, clamped
 * to a floor and a cap. The settlement daemon — which sends the transactions
 * that move money — bid nothing, so under congestion a player's entry would
 * land while the payout that follows it would not. The choice now lives here
 * and both paths call it; `app/src/tx/priority-fee.ts` re-exports these names
 * so nothing in the app changed shape.
 *
 * All constants are PROVISIONAL and founder-tunable (client-side spend and
 * latency knobs, not on-chain economics). Integer micro-lamports throughout;
 * no float touches a fee.
 */

/** PROVISIONAL (founder-tunable): percentile over non-zero recent fees. */
export const PROVISIONAL_PRIORITY_FEE_PERCENTILE = 75;

/**
 * PROVISIONAL (founder-tunable): never bid below this (micro-lamports per
 * CU). Keeps a non-zero bid on quiet clusters where every sample is 0 —
 * 1,000 µlam/CU ≈ 200 lamports on a 200k-CU transaction, about 4% of the
 * base signature fee. Negligible cost for a real inclusion nudge.
 */
export const PROVISIONAL_PRIORITY_FEE_FLOOR_MICROLAMPORTS = 1_000n;

/**
 * PROVISIONAL (founder-tunable): never bid above this (micro-lamports per
 * CU). 2,000,000 µlam/CU caps the priority fee at 0.0004 SOL on a 200k-CU
 * transaction — a spend ceiling against fee spikes, not an inclusion strategy.
 */
export const PROVISIONAL_PRIORITY_FEE_CAP_MICROLAMPORTS = 2_000_000n;

/**
 * Pure percentile-with-clamps over a fee sample. Empty or all-zero samples
 * fall to the floor.
 */
export function pickPriorityFee(
  recentFeesMicroLamports: readonly bigint[],
  percentile: number = PROVISIONAL_PRIORITY_FEE_PERCENTILE,
  floor: bigint = PROVISIONAL_PRIORITY_FEE_FLOOR_MICROLAMPORTS,
  cap: bigint = PROVISIONAL_PRIORITY_FEE_CAP_MICROLAMPORTS
): bigint {
  const nonZero = recentFeesMicroLamports.filter((f) => f > 0n);
  if (nonZero.length === 0) return floor;
  const sorted = [...nonZero].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length * percentile) / 100));
  const picked = sorted[index];
  if (picked < floor) return floor;
  if (picked > cap) return cap;
  return picked;
}
