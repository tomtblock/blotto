/**
 * The engineered population (manual §6.2, §7.2).
 *
 * A full pool's result is CONSTRUCTED, not hoped for. The whole field is ours,
 * so the winner and the loser are decided by arithmetic before anyone enters,
 * and the plan can predict all 64 ranks rather than one.
 *
 * The published rule (backend/scoring/src/engine.ts): a stat goes to the larger
 * number, ties to neither; a battle goes to whoever takes at least 3 of the 5
 * stats, else a draw. So:
 *
 *   cappedField  every stat in 1..25. Nothing here can beat a `wall`, and
 *                nothing loses to a `pole`, because every stat is non-zero.
 *   wall         three stats >= 26, the other two at 0. Against a field capped
 *                at 25 it takes those three stats against EVERY opponent, so it
 *                wins 3 of 5 and therefore wins every battle. Rank 1.
 *   pole         100 on one stat, 0 on the rest. Against any opponent with four
 *                non-zero stats it loses those four, so it loses every battle.
 *                Last place.
 *
 * WHY THE CAP IS 25 AND THE WALL IS 26. The margin is deliberate. If the field
 * could reach 26 and the wall only made 25, every one of those stats would DRAW
 * (ties go to neither) and the engineered result would collapse. One point of
 * separation is all the rule needs, and the cap is what guarantees it.
 *
 * Every generator is deterministic in its seed, so a plan that records a seed
 * records the allocation, and anyone can reproduce it. Each also rotates its
 * shape across the seven battles, because a set with fewer than three distinct
 * shapes trips `allocation_entropy` and two identical sets trip the one
 * allocation signal that hard-blocks (R11).
 */

import { createHash } from 'crypto';

export const STATS = 5;
export const BATTLES = 7;
export const ALLOCATION_SUM = 100;

/** The cap the beatable field obeys, and the floor the wall clears. */
export const FIELD_CAP = 25;
export const WALL_MIN = 26;

export type Allocation = number[];
export interface Entrant {
  generator: string;
  battles: Allocation[];
  timingsMs: number[];
}

/** Deterministic bytes for a seed and a label — the only randomness anywhere. */
function bytes(seed: number, label: string): Buffer {
  return createHash('sha256').update(`blotto-battle-test/pop/${label}/${seed}`).digest();
}

/** A plausible human think-time, varied so it does not trip `timing_profile`,
 * which fires on a uniform cadence. Never the same twice in a set. */
function timings(seed: number, label: string): number[] {
  const h = bytes(seed, `${label}/t`);
  return Array.from({ length: BATTLES }, (_, k) => 1200 + ((h[k] << 8 | h[k + 8]) % 9000));
}

function assertAllocation(a: Allocation, who: string): void {
  if (a.length !== STATS) throw new Error(`${who}: ${a.length} stats, expected ${STATS}`);
  let sum = 0;
  for (const v of a) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`${who}: ${JSON.stringify(a)} is not five non-negative integers`);
    sum += v;
  }
  if (sum !== ALLOCATION_SUM) throw new Error(`${who}: sums to ${sum}, not ${ALLOCATION_SUM}`);
}

/**
 * The beatable background: five stats, each at least 1 and at most FIELD_CAP,
 * summing to exactly 100.
 *
 * Five stats capped at 25 sum to at most 125, so a valid draw exists, but a
 * naive random split rarely lands one. Rather than rejection-sample (which can
 * run long near the boundary) this distributes the 100 one unit at a time over
 * stats that still have room, which always terminates and is uniform enough for
 * a background field.
 */
export function cappedFieldAllocation(seed: number, battle: number): Allocation {
  const h = bytes(seed, `capped/${battle}`);
  const out = new Array<number>(STATS).fill(1); // every stat non-zero: that is what makes the pole lose
  let left = ALLOCATION_SUM - STATS;
  let i = 0;
  while (left > 0) {
    const pick = h[i % h.length] % STATS;
    i++;
    if (out[pick] < FIELD_CAP) {
      out[pick]++;
      left--;
    } else if (out.every((v) => v >= FIELD_CAP)) {
      // Cannot happen at 5x25 = 125 >= 100, but fail loudly rather than loop.
      throw new Error('cappedField: every stat is at the cap with budget left');
    }
  }
  assertAllocation(out, `cappedField(${seed},${battle})`);
  if (out.some((v) => v > FIELD_CAP || v < 1)) {
    throw new Error(`cappedField(${seed},${battle}): ${JSON.stringify(out)} breaks the 1..${FIELD_CAP} cap`);
  }
  return out;
}

export function cappedField(seed: number): Entrant {
  return {
    generator: 'cappedField',
    battles: Array.from({ length: BATTLES }, (_, k) => cappedFieldAllocation(seed, k)),
    timingsMs: timings(seed, 'capped'),
  };
}

/**
 * The engineered winner: three stats at or above WALL_MIN, two at zero, and
 * WHICH three rotates per battle so the set carries seven distinct shapes.
 */
export function wallAllocation(seed: number, battle: number): Allocation {
  const h = bytes(seed, `wall/${battle}`);
  // Choose three of the five stats, rotating with the battle index so the
  // shape moves even when the seed's bytes repeat.
  const order = [0, 1, 2, 3, 4].sort((a, b) => (h[a] - h[b]) || (a - b));
  const chosen = order.slice(0, 3).map((s) => (s + battle) % STATS);
  const uniq = Array.from(new Set(chosen));
  while (uniq.length < 3) for (let s = 0; s < STATS; s++) if (!uniq.includes(s)) { uniq.push(s); break; }

  const out = new Array<number>(STATS).fill(0);
  // 100 over three stats, each at least WALL_MIN: 26+26+26 = 78 leaves 22 to
  // spread, so every one of the three clears the cap with room.
  uniq.forEach((s) => (out[s] = WALL_MIN));
  let left = ALLOCATION_SUM - WALL_MIN * 3;
  let i = 0;
  while (left > 0) {
    out[uniq[h[i % h.length] % 3]]++;
    left--;
    i++;
  }
  assertAllocation(out, `wall(${seed},${battle})`);
  if (out.filter((v) => v >= WALL_MIN).length < 3) {
    throw new Error(`wall(${seed},${battle}): ${JSON.stringify(out)} does not have three stats at ${WALL_MIN}+`);
  }
  return out;
}

export function wall(seed: number): Entrant {
  return {
    generator: 'wall',
    battles: Array.from({ length: BATTLES }, (_, k) => wallAllocation(seed, k)),
    timingsMs: timings(seed, 'wall'),
  };
}

/** The certain loser: everything on one stat, and which one rotates. */
export function poleAllocation(seed: number, battle: number): Allocation {
  // The base stat comes from the SEED ALONE, then rotates by the battle index.
  // Re-hashing per battle would make the position effectively random, and seven
  // random draws over five stats collide often enough to land two distinct
  // shapes — which trips `allocation_entropy` "strong". Rotating deterministically
  // guarantees five distinct positions across seven battles.
  const base = bytes(seed, 'pole')[0] % STATS;
  const out = new Array<number>(STATS).fill(0);
  out[(base + battle) % STATS] = ALLOCATION_SUM;
  assertAllocation(out, `pole(${seed},${battle})`);
  return out;
}

export function pole(seed: number): Entrant {
  return {
    generator: 'pole',
    battles: Array.from({ length: BATTLES }, (_, k) => poleAllocation(seed, k)),
    timingsMs: timings(seed, 'pole'),
  };
}

/**
 * How many distinct shapes a set carries, measured EXACTLY as the detection
 * signal measures it: `backend/detection/src/signals.ts` does
 * `e.battles.map((b) => b.join(','))` and counts the distinct strings, so the
 * allocation is compared UNSORTED and `[100,0,0,0,0]` differs from
 * `[0,100,0,0,0]`.
 *
 * This matters. A sorted comparison would call a rotating `pole` one shape and
 * reject a legitimate plan, because a pole's sorted form never changes however
 * far it rotates. Matching the real signal is the point: the plan should
 * predict what detection will actually say.
 *
 * `allocation_entropy` fires "strong" at <= 2 distinct.
 */
export function distinctShapes(battles: Allocation[]): number {
  return new Set(battles.map((b) => b.join(','))).size;
}

/**
 * The share of stat values that are multiples of ten — the OTHER half of
 * `allocation_entropy`, which raises a "note" at >= 90% (`signals.ts`). A pole
 * is all zeroes and a hundred, so it is 100% round and will always draw this
 * note. That is predicted in the plan rather than discovered in the report.
 */
export function roundShare(battles: Allocation[]): number {
  const v = battles.flat();
  return v.filter((x) => x % 10 === 0).length / v.length;
}
