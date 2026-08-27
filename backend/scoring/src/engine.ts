/**
 * The all-vs-all scoring engine (roadmap 2.1; PID §4.4/§5, TECH-ARCH §6).
 *
 * Every player faces the identical field — no pairing exists. For every pair
 * and every battle index: a stat is won by the larger number (ties to
 * neither); the battle is won by three or more stats; if neither side
 * reaches three, the battle is a draw.
 *
 * SCORE IS CARRIED IN INTEGER HALF-POINTS — win 2, draw 1, loss 0. "Half a
 * win" never exists as 0.5: the no-floats-in-money-or-scoring rule
 * (CLAUDE.md) applies in this engine exactly as on-chain. Display code may
 * divide by two at the last moment; this module never does.
 *
 * Ranking: score desc, then zones (total stats won across all comparisons)
 * desc, then entry index asc. TECH-ARCH §6 writes the last tie-break as
 * "entered_at asc"; entry index is that same order made strictly monotonic
 * (two entries can share a timestamp, never a seat) — recorded in the
 * Phase 2 report.
 *
 * Pure module: no I/O, no Date, no randomness.
 */

import { BATTLES, STATS, type Allocation, type BattleSet, assertBattleSet } from './allocation';

export type BattleOutcome = 'win' | 'loss' | 'draw';

/** One battle comparison, from `a`'s perspective. */
export interface BattleComparison {
  outcome: BattleOutcome;
  /** Stats won by `a`. */
  statsA: number;
  /** Stats won by `b`. */
  statsB: number;
}

/** Compare one battle (PID §4.4). */
export function compareBattle(a: Allocation, b: Allocation): BattleComparison {
  let statsA = 0;
  let statsB = 0;
  for (let z = 0; z < STATS; z++) {
    if (a[z] > b[z]) statsA++;
    else if (b[z] > a[z]) statsB++;
  }
  const outcome: BattleOutcome = statsA >= 3 ? 'win' : statsB >= 3 ? 'loss' : 'draw';
  return { outcome, statsA, statsB };
}

/** One player's scored result. */
export interface PlayerResult {
  /** Entry index (seat), 0-based — the identity throughout. */
  index: number;
  /** Score in half-points: win 2, draw 1 per battle comparison. */
  scoreHalf: number;
  /** Total stats won across every comparison — the first tie-break. */
  zones: number;
  /** Final rank, 1-based, unique. */
  rank: number;
}

/**
 * Score a whole pool. `players[i]` is seat i's battle set. Returns one
 * result per player, in seat order, with unique 1-based ranks.
 */
export function scorePool(players: readonly BattleSet[]): PlayerResult[] {
  for (const p of players) assertBattleSet(p as readonly (readonly number[])[]);
  const n = players.length;
  const scoreHalf = new Array<number>(n).fill(0);
  const zones = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = 0; k < BATTLES; k++) {
        const c = compareBattle(players[i][k], players[j][k]);
        zones[i] += c.statsA;
        zones[j] += c.statsB;
        if (c.outcome === 'win') scoreHalf[i] += 2;
        else if (c.outcome === 'loss') scoreHalf[j] += 2;
        else {
          scoreHalf[i] += 1;
          scoreHalf[j] += 1;
        }
      }
    }
  }
  const order = [...Array(n).keys()].sort(
    (i, j) => scoreHalf[j] - scoreHalf[i] || zones[j] - zones[i] || i - j
  );
  const rank = new Array<number>(n).fill(0);
  order.forEach((i, pos) => {
    rank[i] = pos + 1;
  });
  return [...Array(n).keys()].map((i) => ({
    index: i,
    scoreHalf: scoreHalf[i],
    zones: zones[i],
    rank: rank[i],
  }));
}

/** Seat indices in rank order (rank 1 first). */
export function rankOrder(results: readonly PlayerResult[]): number[] {
  return [...results].sort((a, b) => a.rank - b.rank).map((r) => r.index);
}
