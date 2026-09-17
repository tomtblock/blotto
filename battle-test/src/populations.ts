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
 * The same two roles, but reachable THROUGH THE LIVE DIAL UI in a handful of
 * drags — which is what the founder's two seats actually need.
 *
 * `wall(seed)` and `pole(seed)` above are for wallets we drive, where any legal
 * set can be submitted exactly. A founder playing on blotto.gg has neither of
 * those luxuries:
 *
 *  - the dials re-apportion the other four stats after every drag
 *    (`app/src/components/blot/rebalance.ts`), so an arbitrary five-number
 *    target takes many careful drags to hit;
 *  - the run clock is **90 seconds for all seven battles** together, starting
 *    at the first dial touch (`app/src/battle/run-clock.ts`), and on expiry
 *    every battle not locked in is entered as the EVEN SPLIT — which is
 *    neither a wall nor a pole and would break the prediction outright.
 *
 * So these two sets are not chosen; they are DERIVED from the app's own dial
 * rule, as the exact output of the shortest drag sequence that reaches each
 * role from the even split every screen opens at:
 *
 *   wall — drag two stats to 0, a different pair each battle (2 drags)
 *   pole — drag one stat to 100, rotating which           (1 drag)
 *
 * 14 drags and 7 drags across the whole run. The values below were computed by
 * running `rebalance` from `EVEN_SPLIT`, not written by hand, and the founder
 * instruction in FOUNDER-ACTIONS.md is the drag list that produces them.
 */
const UI_WALL_ZERO_PAIRS: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [0, 2], [1, 3],
];

/** Seven battles, three stats at 33 or 34 in each — all above the field cap. */
export function uiWall(): Entrant {
  const battles: Allocation[] = [
    [0, 0, 34, 33, 33],
    [34, 0, 0, 33, 33],
    [34, 33, 0, 0, 33],
    [34, 33, 33, 0, 0],
    [0, 34, 33, 33, 0],
    [0, 34, 0, 33, 33],
    [34, 0, 33, 0, 33],
  ];
  battles.forEach((b, k) => {
    assertAllocation(b, `uiWall(${k})`);
    if (b.filter((v) => v >= WALL_MIN).length < 3) {
      throw new Error(`uiWall battle ${k}: fewer than three stats at ${WALL_MIN} or above`);
    }
  });
  if (battles.length !== UI_WALL_ZERO_PAIRS.length) {
    throw new Error('uiWall: one allocation per drag pair, or the founder instruction does not match');
  }
  return { generator: 'uiWall', battles, timingsMs: timings(0, 'uiWall') };
}

/** Seven battles, everything on one stat, rotating which. */
export function uiPole(): Entrant {
  const battles: Allocation[] = [
    [100, 0, 0, 0, 0],
    [0, 100, 0, 0, 0],
    [0, 0, 100, 0, 0],
    [0, 0, 0, 100, 0],
    [0, 0, 0, 0, 100],
    [0, 0, 100, 0, 0],
    [100, 0, 0, 0, 0],
  ];
  battles.forEach((b, k) => assertAllocation(b, `uiPole(${k})`));
  return { generator: 'uiPole', battles, timingsMs: timings(0, 'uiPole') };
}

/**
 * T5's two founder seats: ORDINARY FIELD players, reachable in ONE drag a battle.
 *
 * T4 needed the founder to hold a winning shape. T5 needs the opposite — both
 * founder wallets are ordinary entrants who do NOT win, because the point of
 * the test is that the winner is not privileged by being the operator's own
 * account. So the rule they play by is the field's own rule: **every stat
 * between 1 and 25**.
 *
 * That range is what makes the prediction unconditional in both directions.
 * Nothing at 25 or below can beat a wall holding three stats at 26+, so a
 * founder seat cannot take rank 1; and five NON-ZERO stats beat a pole's single
 * spike four stats to one, so it cannot come last either. Ranks 2..63,
 * whatever the exact numbers — which matters, because T4 showed a human at a
 * dial under a ninety-second clock lands on different numbers than the plan
 * (§H10). The zero floor is load-bearing: a seat with two or more zeroes can
 * DRAW with a pole instead of beating it, and the "cannot come last" half stops
 * holding.
 *
 * Derived from the app's own dial rule, like `uiWall`/`uiPole`: from the even
 * split every screen opens at, one drag takes a stat to 25 and the other four
 * absorb it, landing on 19s and an 18. The two wallets rotate through different
 * stats so their seven-battle sets differ — an identical set shared by two
 * entrants is `duplicate_sets`, the one allocation signal that hard-blocks.
 */
function uiFieldFrom(order: readonly number[], generator: string): Entrant {
  const battles: Allocation[] = order.map((k) => {
    // The dial rule's own arithmetic: 100 − 25 = 75 over four stats is 18.75,
    // which largest-remainder rounds to three 19s and one 18. The 18 lands on
    // the last stat, or the second-to-last when the last is the one dragged.
    const a = new Array<number>(STATS).fill(19);
    a[k === STATS - 1 ? STATS - 2 : STATS - 1] = 18;
    a[k] = 25;
    return a;
  });
  battles.forEach((b, i) => {
    assertAllocation(b, `${generator}(${i})`);
    if (b.some((v) => v < 1 || v > FIELD_CAP)) {
      throw new Error(`${generator} battle ${i}: a stat is outside 1..${FIELD_CAP}`);
    }
  });
  return { generator, battles, timingsMs: timings(0, generator) };
}

/** UI-A in T5 — an ordinary field seat. Rotates Strength→Durability. */
export function uiFieldA(): Entrant {
  return uiFieldFrom([0, 1, 2, 3, 4, 0, 2], 'uiFieldA');
}

/** UI-B in T5 — an ordinary field seat, rotating the other way so the two
 * wallets never share a seven-battle set. */
export function uiFieldB(): Entrant {
  return uiFieldFrom([4, 3, 2, 1, 0, 3, 1], 'uiFieldB');
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
