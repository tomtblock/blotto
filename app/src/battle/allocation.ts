/*
 * The allocation model behind the pentagon radar (PID v0.5 §4.2).
 *
 * The interaction keeps a RAW (unnormalised, fractional) weight per stat;
 * a drag writes one stat's raw value and touches nothing else. After every
 * movement the five raws are rescaled to sum to exactly 100 and rounded to
 * integers, with the whole rounding remainder placed on the largest stat —
 * "the displayed integers are always the real allocation." The player never
 * does arithmetic and never sees a points-remaining counter.
 *
 * THE CLIENT INVARIANT (PID §4.6): nothing can leave this module except five
 * non-negative integers summing to exactly 100 in the fixed stat order.
 * `normalize` is total over every non-negative raw state and returns such a
 * tuple ALWAYS — the 10k-sequence property test in allocation.test.ts is the
 * roadmap 3.4 gate.
 *
 * Deliberately absent, and to be refused in review (PID §4.3, quantified):
 * presets, quick-set chips, named shapes, snapping. Any prominent discrete
 * target collapses the 4,598,126-option space toward 126 and the draw rate
 * from 7% toward 86%. There is ONE button: even split.
 */

export const STATS = 5;
export const ALLOCATION_SUM = 100;
export const STAT_NAMES = ['Strength', 'Speed', 'Heart', 'Wit', 'Durability'] as const;

/** Five non-negative integers summing to exactly 100, fixed stat order. */
export type Allocation = readonly [number, number, number, number, number];

/** The raw, in-interaction weights. Non-negative finite numbers. */
export type RawWeights = readonly [number, number, number, number, number];

export const EVEN_SPLIT: Allocation = [20, 20, 20, 20, 20];
/** Raw state matching the even split — every screen opens here. */
export const EVEN_RAW: RawWeights = [20, 20, 20, 20, 20];

/**
 * Rescale + round: raws → the real allocation.
 *
 *  - scale each raw to `raw * 100 / total`;
 *  - floor each;
 *  - the remainder (0..4) goes ON THE LARGEST STAT, whole — largest by
 *    scaled value, ties to the earliest in stat order (deterministic);
 *  - an all-zero raw state normalises to the even split (nothing else is
 *    principled, and the drag model cannot produce it from a live screen
 *    anyway — dragging one vertex to zero leaves four positive raws).
 */
export function normalize(raw: RawWeights): Allocation {
  for (const v of raw) {
    if (!Number.isFinite(v) || v < 0) {
      throw new Error(`raw weights must be finite and non-negative, got ${v}`);
    }
  }
  const total = raw[0] + raw[1] + raw[2] + raw[3] + raw[4];
  if (total <= 0) return EVEN_SPLIT;
  const scaled = raw.map((v) => (v * ALLOCATION_SUM) / total);
  const floors = scaled.map(Math.floor) as unknown as number[];
  const remainder = ALLOCATION_SUM - floors.reduce((a, b) => a + b, 0);
  let largest = 0;
  for (let i = 1; i < STATS; i++) {
    if (scaled[i] > scaled[largest]) largest = i;
  }
  floors[largest] += remainder;
  return floors as unknown as Allocation;
}

/** A drag writes ONE stat's raw value (clamped at 0); the rest are untouched. */
export function dragTo(raw: RawWeights, stat: number, value: number): RawWeights {
  if (!Number.isInteger(stat) || stat < 0 || stat >= STATS) {
    throw new Error(`stat index out of range: ${stat}`);
  }
  const next = [...raw] as number[];
  next[stat] = Math.max(0, Number.isFinite(value) ? value : 0);
  return next as unknown as RawWeights;
}

/** Sanity assertion used at the submission boundary — throws on violation. */
export function assertAllocation(a: readonly number[]): asserts a is Allocation {
  if (a.length !== STATS) throw new Error(`allocation must have ${STATS} stats`);
  let sum = 0;
  for (const v of a) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`bad allocation value ${v}`);
    sum += v;
  }
  if (sum !== ALLOCATION_SUM) throw new Error(`allocation sums to ${sum}, not ${ALLOCATION_SUM}`);
}
