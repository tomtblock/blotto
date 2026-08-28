/*
 * Profile insights (UI constitution 6.8) — pure logic for the badge case
 * and the film room. Browser-ready, no wallet, no floats in anything a
 * player is paid (band inference is exact bigint arithmetic).
 *
 * Placement badges derive from COMMITTED PAYOUTS, not from rank labels —
 * ranks live in the published bundle (D3-B), but a payout equal to an
 * exact prize band identifies the band it paid: amount × 1024 = pot ×
 * band, integer-exact by construction (pots are multiples of 1024). A
 * tie-split amount matches no band and counts as a shared placement —
 * stated as such, never rounded to a rank. Every number here is
 * recomputable on the Verify page.
 *
 * The film room's comparisons run the SAME engine as the crank
 * (compareBattle, R20), over battles decrypted post-reveal in the
 * player's own browser. All comparative data is post-reveal only.
 */

import { compareBattle, type Allocation, type BattleSet } from '@blotto/scoring';
import type { CareerRow } from '@/data/types';

/* The band table, mirrored from the published prize table (format.ts). */
const BAND_1024 = [270n, 158n, 102n, 78n, 50n, 27n] as const;
export type PrizeBand = 1 | 2 | 3 | 4 | 5 | 9;
const BAND_RANK: readonly PrizeBand[] = [1, 2, 3, 4, 5, 9];

/** Which exact prize band a committed amount paid, or 'shared' for a
 * nonzero amount that matches none (a split tie), or null for unpaid. */
export function bandForAmount(
  amountLamports: string,
  potLamports: string | null
): PrizeBand | 'shared' | null {
  const amount = BigInt(amountLamports);
  if (amount <= 0n || potLamports === null) return null;
  const pot = BigInt(potLamports);
  for (let i = 0; i < BAND_1024.length; i++) {
    if (amount * 1024n === pot * BAND_1024[i]) return BAND_RANK[i];
  }
  return 'shared';
}

export interface BadgeCounts {
  first: number;
  top3: number;
  /** Every paid finish (top-16 by construction; ties can extend it). */
  paid: number;
  /** Paid via a tie-split amount — a shared placement, stated as such. */
  shared: number;
}

export function badgeCounts(career: readonly CareerRow[]): BadgeCounts {
  const counts: BadgeCounts = { first: 0, top3: 0, paid: 0, shared: 0 };
  for (const row of career) {
    if (!row.paid) continue;
    counts.paid += 1;
    const band = bandForAmount(row.amount_lamports, row.pot_lamports);
    if (band === 'shared') counts.shared += 1;
    else if (band === 1) {
      counts.first += 1;
      counts.top3 += 1;
    } else if (band === 2 || band === 3) counts.top3 += 1;
  }
  return counts;
}

/** Largest-remainder rounding to a fixed sum (display only). */
function roundedTo(values: readonly number[], sum: number): number[] {
  const floors = values.map(Math.floor);
  let remainder = sum - floors.reduce((a, b) => a + b, 0);
  const order = values
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors;
}

export interface FilmRoomBattle {
  /** 0-based battle index. */
  index: number;
  mine: Allocation;
  /** The field's mean allocation for this battle (everyone but you),
   * largest-remainder rounded so the display sums to exactly 100. */
  fieldMean: number[];
  /** Stats where your value beat the field mean — the LIGHT stats. */
  statsAboveMean: number[];
  /** This battle against every other decrypted seat's same battle. */
  wins: number;
  draws: number;
  losses: number;
}

/** The film room for one seat: seven battles, each against the whole
 * decrypted field. Returns null when your battles are not in the map. */
export function filmRoomForSeat(
  mySeat: number,
  battlesBySeat: ReadonlyMap<number, BattleSet>
): FilmRoomBattle[] | null {
  const mine = battlesBySeat.get(mySeat);
  if (!mine) return null;

  return mine.map((allocation, k) => {
    const sums = [0, 0, 0, 0, 0];
    let others = 0;
    let wins = 0;
    let draws = 0;
    let losses = 0;
    for (const [seat, theirs] of battlesBySeat) {
      if (seat === mySeat) continue;
      others += 1;
      const battle = theirs[k];
      for (let s = 0; s < 5; s++) sums[s] += battle[s];
      const c = compareBattle(allocation, battle);
      if (c.outcome === 'win') wins += 1;
      else if (c.outcome === 'draw') draws += 1;
      else losses += 1;
    }
    const mean = others > 0 ? sums.map((v) => v / others) : [20, 20, 20, 20, 20];
    const fieldMean = roundedTo(mean, 100);
    const statsAboveMean = allocation
      .map((v, s) => (v > mean[s] ? s : -1))
      .filter((s) => s >= 0);
    return { index: k, mine: allocation, fieldMean, statsAboveMean, wins, draws, losses };
  });
}
