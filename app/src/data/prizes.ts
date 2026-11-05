/*
 * How a pool's prizes are GROUPED for display (D-E19, the Ladder) — pure,
 * integer-only, no words. The words live in the copy module
 * (`COPY.prizes`); the amounts come from the pool's own table
 * (`poolLadder`) or, on the rules page, from `LADDER_TABLES` × the entry
 * price. Nothing here computes an amount: it only decides which places
 * share a row.
 *
 * Two groupings, for two surfaces:
 *
 *  - BANDS (the prize tables): the fixed rows the founder's brief names —
 *    1st, 2nd, 3rd, 4th, 5th–8th, 9th–16th — cut to the places the pool
 *    pays. A band is one row only when every place in it pays the same:
 *    the launch tables always do, but a pool's table is its on-chain copy,
 *    and a row that printed "0.2 SOL each" over places that differ would be
 *    a false statement about money. Such a band splits into one row per
 *    place rather than guessing.
 *
 *  - RUNS (the prize sentence): consecutive places paying the same amount,
 *    so prose reads "3rd and 4th 0.2 SOL each, 5th to 8th 0.1 SOL each".
 */
import { LADDER_TABLES, MIN_FIELD_BY_CAPACITY, POOL_CAPACITIES } from '@blotto/scoring';
import type { SizeFacts } from '@/copy';

/**
 * The four launch sizes with their minimum fields and paid places — every
 * figure from the published tables in @blotto/scoring, for the prose that
 * describes the sizes in general (the landing's steps, the rules). A LIVE
 * pool's figures are its own (`poolLadder`), never these.
 */
export const LAUNCH_SIZES: readonly SizeFacts[] = POOL_CAPACITIES.map((capacity) => ({
  capacity,
  minField: MIN_FIELD_BY_CAPACITY[capacity],
  paidPlaces: LADDER_TABLES[capacity].length,
}));

export interface PrizeBand {
  /** First place in the row, 1-based. */
  from: number;
  /** Last place in the row (equal to `from` for a single place). */
  to: number;
  /** Lamports EACH place in the row is paid. */
  each: bigint;
}

/** The fixed band edges, inclusive: 1, 2, 3, 4, 5–8, 9–16. */
const BAND_EDGES: readonly (readonly [number, number])[] = [
  [1, 1],
  [2, 2],
  [3, 3],
  [4, 4],
  [5, 8],
  [9, 16],
];

/**
 * The prize table's rows. `amounts` is lamports per paid place, rank 1
 * first (`poolLadder().prizeAmounts`).
 */
export function prizeBands(amounts: readonly bigint[]): PrizeBand[] {
  const out: PrizeBand[] = [];
  for (const [lo, hi] of BAND_EDGES) {
    if (lo > amounts.length) break;
    const to = Math.min(hi, amounts.length);
    const slice = amounts.slice(lo - 1, to);
    if (slice.every((a) => a === slice[0])) {
      out.push({ from: lo, to, each: slice[0]! });
    } else {
      // Unequal places inside one band: one row each, never an "each" that lies.
      slice.forEach((a, i) => out.push({ from: lo + i, to: lo + i, each: a }));
    }
  }
  // A table wider than the last edge (none exists at launch: 64 pays 16):
  // one row per extra place rather than dropping a paid place.
  for (let place = BAND_EDGES[BAND_EDGES.length - 1]![1] + 1; place <= amounts.length; place++) {
    out.push({ from: place, to: place, each: amounts[place - 1]! });
  }
  return out;
}

/** Consecutive places paying the same amount, best first. */
export function prizeRuns(amounts: readonly bigint[]): PrizeBand[] {
  const out: PrizeBand[] = [];
  amounts.forEach((a, i) => {
    const last = out[out.length - 1];
    if (last && last.each === a && last.to === i) last.to = i + 1;
    else out.push({ from: i + 1, to: i + 1, each: a });
  });
  return out;
}
