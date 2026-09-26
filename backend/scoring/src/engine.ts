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
 * Ranking (D3-B, ratified 2026-08-27): score desc, then zones (total stats
 * won across all comparisons) desc. Players equal on BOTH are TIED — they
 * share a competition rank (1, 2, 2, 4: rank = one plus the number of
 * players strictly better) and split the combined prize of the positions
 * their group occupies (`assignPrizes`). Entry index never decides who is
 * ranked above whom or who is paid; it only places the indivisible lamport
 * remainder of a split (lowest seat in the group) and fixes the published
 * leaf order (rank asc, entry index asc).
 *
 * Pure module: no I/O, no Date, no randomness.
 */

import {
  BATTLES,
  STATS,
  type Allocation,
  type BattleSet,
  type BoardMode,
  assertBattleSet,
} from './allocation';
import { PAID_RANKS, PRIZE_BANDS_1024 } from './prizes';

export type BattleOutcome = 'win' | 'loss' | 'draw';

/** One battle comparison, from `a`'s perspective. */
export interface BattleComparison {
  outcome: BattleOutcome;
  /** Stats won by `a`. */
  statsA: number;
  /** Stats won by `b`. */
  statsB: number;
}

/**
 * Compare one battle (PID §4.4). Mode-blind on purpose: the rule is the same
 * whether each battle carried 100 or the board carried 700 — a stat is won
 * by the larger number, a battle by three or more stats. (In hard mode a
 * 5–0 sweep is possible, since a battle need not hold any points at all.)
 */
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
  /**
   * Competition rank, 1-based, SHARED by players tied on (score, zones):
   * 1, 2, 2, 4 — rank = one plus the number of strictly-better players.
   */
  rank: number;
  /**
   * This seat's prize in lamports — 0n from `scorePool`, filled by
   * `assignPrizes`. BIGINT always; a lamport amount never passes through a
   * JavaScript number.
   */
  amountLamports: bigint;
}

/**
 * Score a whole pool. `players[i]` is seat i's battle set. Returns one
 * result per player, in seat order, with shared competition ranks and
 * `amountLamports` still 0n (see `assignPrizes`). `mode` decides which
 * placing rule every set is validated against (Phase B); the comparison
 * and the ranking are the same in both.
 */
export function scorePool(players: readonly BattleSet[], mode: BoardMode = 'easy'): PlayerResult[] {
  for (const p of players) assertBattleSet(p as readonly (readonly number[])[], mode);
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
  return assignRanks(
    [...Array(n).keys()].map((i) => ({ index: i, scoreHalf: scoreHalf[i], zones: zones[i] }))
  );
}

/** A scored player before ranking: the two values D3-B ranks on, and a seat. */
export interface ScoredPlayer {
  readonly index: number;
  readonly scoreHalf: number;
  readonly zones: number;
}

/**
 * Competition ranks (D3-B) over already-computed (scoreHalf, zones), returned
 * in seat order with `amountLamports` zeroed for `assignPrizes` to fill.
 *
 * Extracted 2026-09-21. `scorePool` had this inline and `scoreWithMissing`
 * carried a second copy of it, which is the shape of bug that does not
 * announce itself: two rankings that agree on every test anyone thought to
 * write and disagree on the pool that pays out. There is one ranking rule and
 * now one implementation of it, and the Python oracle checks that one.
 *
 * Players equal on BOTH score and zones are tied and share a rank — one plus
 * the number of strictly-better players, so 1, 2, 2, 4. Entry index orders
 * within a tie group so the sort is deterministic, and never breaks a rank.
 */
export function assignRanks(scored: readonly ScoredPlayer[]): PlayerResult[] {
  const seats = [...scored].sort((a, b) => a.index - b.index);
  const order = [...seats].sort(
    (a, b) => b.scoreHalf - a.scoreHalf || b.zones - a.zones || a.index - b.index
  );
  const rank = new Map<number, number>();
  let groupStartPos = 0;
  order.forEach((p, pos) => {
    const prev = order[pos - 1];
    if (pos > 0 && (p.scoreHalf !== prev.scoreHalf || p.zones !== prev.zones)) groupStartPos = pos;
    rank.set(p.index, groupStartPos + 1);
  });
  return seats.map((p) => ({
    index: p.index,
    scoreHalf: p.scoreHalf,
    zones: p.zones,
    rank: rank.get(p.index)!,
    amountLamports: 0n,
  }));
}

/**
 * Seat indices in the published leaf order: rank asc, entry index asc.
 * (Ranks repeat under D3-B, so the index tie-break is load-bearing here —
 * it fixes the Merkle leaf order, nothing about money.)
 */
export function rankOrder(results: readonly PlayerResult[]): number[] {
  return [...results].sort((a, b) => a.rank - b.rank || a.index - b.index).map((r) => r.index);
}

/**
 * D3-B split-pot prize assignment. A tie group whose members share rank r
 * with size s occupies positions r..r+s-1; its combined prize is the sum of
 * the band amounts of those positions that are ≤ PAID_RANKS (positions
 * past the table pay zero). Each member takes floor(combined / s); the
 * indivisible lamport remainder goes to the group's lowest entry index.
 * Every tied member with a nonzero share is paid. Under D-E2 (one paid
 * place) that means: the sole rank-1 player takes the pot, or a tie for
 * first splits it; nobody ranked second or lower is paid.
 *
 * Returns a NEW array in seat order with `amountLamports` filled. The sum
 * of all amounts equals the sum of the band amounts (the whole pot),
 * exactly — conservation is asserted, not assumed.
 */
export function assignPrizes(results: readonly PlayerResult[], pot: bigint): PlayerResult[] {
  const out = results.map((r) => ({ ...r, amountLamports: 0n }));
  // Group members by shared rank.
  const byRank = new Map<number, number[]>();
  for (const r of out) {
    const g = byRank.get(r.rank);
    if (g) g.push(r.index);
    else byRank.set(r.rank, [r.index]);
  }
  const bySeat = new Map<number, (typeof out)[number]>(out.map((r) => [r.index, r]));
  let paidTotal = 0n;
  for (const [rank, seats] of byRank) {
    const size = BigInt(seats.length);
    let combined = 0n;
    for (let pos = rank; pos < rank + seats.length; pos++) {
      if (pos <= PAID_RANKS) combined += (pot * PRIZE_BANDS_1024[pos - 1]) / 1024n;
    }
    if (combined === 0n) continue;
    const each = combined / size;
    const remainder = combined % size;
    const lowestSeat = Math.min(...seats);
    for (const seat of seats) {
      const r = bySeat.get(seat);
      if (!r) throw new Error(`missing seat ${seat}`);
      r.amountLamports = each + (seat === lowestSeat ? remainder : 0n);
      paidTotal += r.amountLamports;
    }
  }
  // With n players the occupied positions are 1..n, so the expected total
  // is the first min(PAID_RANKS, n) bands — the whole pot for any pool with
  // at least one player (pools run with 52..64, D-E4).
  let expected = 0n;
  for (let pos = 1; pos <= Math.min(PAID_RANKS, out.length); pos++) {
    expected += (pot * PRIZE_BANDS_1024[pos - 1]) / 1024n;
  }
  if (paidTotal !== expected) {
    throw new Error(`split-pot conservation failed: paid ${paidTotal}, expected ${expected}`);
  }
  return out;
}
