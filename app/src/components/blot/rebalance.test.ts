/*
 * The dial-coupling rule, pinned to the brief's acceptance tests (§9.1–2)
 * and its worked example. The battle-critical property: whatever a dial
 * does, nothing leaves except five non-negative integers summing to
 * exactly 100 — and the dragged stat lands where the finger put it.
 */
import { describe, expect, it } from 'vitest';
import { ALLOCATION_SUM, EVEN_SPLIT, type Allocation } from '@/battle/allocation';
import { NO_LOCKS, maxTarget, rebalance, rebalanceLocked, type Locks } from './rebalance';

const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);

describe('rebalance', () => {
  it('reproduces the brief’s worked example exactly', () => {
    // {37,22,12,8,21}, drag STR → 57: others 22:12:8:21 of 43 → {57,15,8,6,14}.
    expect(rebalance([37, 22, 12, 8, 21], 0, 57)).toEqual([57, 15, 8, 6, 14]);
  });

  it('pins the dragged stat exactly and rebalances the others proportionally', () => {
    const next = rebalance(EVEN_SPLIT, 0, 60);
    expect(next).toEqual([60, 10, 10, 10, 10]);
  });

  it('is idempotent at the bounds: 100 empties the others, and back to 20 splits evenly', () => {
    const allIn = rebalance(EVEN_SPLIT, 2, 100);
    expect(allIn).toEqual([0, 0, 100, 0, 0]);
    // Others all at 0 → equal split of the remainder (brief §9.2).
    expect(rebalance(allIn, 2, 20)).toEqual([20, 20, 20, 20, 20]);
  });

  it('keeps a stat at 0 at 0 — nothing is given back to an abandoned stat by a drag elsewhere', () => {
    const withZero: Allocation = [50, 30, 0, 10, 10];
    const next = rebalance(withZero, 0, 30);
    expect(next[2]).toBe(0);
    expect(sum(next)).toBe(ALLOCATION_SUM);
  });

  it('clamps impossible targets and shows the dial at the clamped value', () => {
    expect(rebalance(EVEN_SPLIT, 1, 250)[1]).toBe(100);
    expect(rebalance(EVEN_SPLIT, 1, -30)[1]).toBe(0);
    expect(sum(rebalance(EVEN_SPLIT, 1, 250))).toBe(ALLOCATION_SUM);
  });

  it('preserves sum === 100 with integers only across 10,000 random drags (brief §9.1)', () => {
    let alloc: Allocation = EVEN_SPLIT;
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let n = 0; n < 10_000; n++) {
      const k = Math.floor(rand() * 5);
      const t = Math.floor(rand() * 101);
      alloc = rebalance(alloc, k, t);
      expect(alloc[k]).toBe(t); // dragged stat lands on target
      let s = 0;
      for (const v of alloc) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
        s += v;
      }
      expect(s).toBe(ALLOCATION_SUM);
    }
  });
});

/*
 * LOCKS (founder 2026-09-13): a locked stat keeps its value whatever the
 * other dials do, and the others share what remains. Added beside the
 * unlocked suite above, which is untouched — `rebalance` is now the
 * no-locks case of `rebalanceLocked` and must behave exactly as before.
 */
describe('rebalanceLocked', () => {
  const L = (...idx: number[]): Locks => [0, 1, 2, 3, 4].map((i) => idx.includes(i));

  it('with no locks is exactly rebalance', () => {
    expect(rebalanceLocked([37, 22, 12, 8, 21], 0, 57, NO_LOCKS)).toEqual(rebalance([37, 22, 12, 8, 21], 0, 57));
  });

  it("the founder's example: Strength locked at 20, the other four share 80", () => {
    // Drag Speed to 50 with Strength locked: Strength stays 20; Heart, Wit,
    // Durability share 30 of what was 60 → 10 each; sum 100.
    expect(rebalanceLocked(EVEN_SPLIT, 1, 50, L(0))).toEqual([20, 50, 10, 10, 10]);
    // And no unlocked dial can reach past 80.
    expect(maxTarget(EVEN_SPLIT, 1, L(0))).toBe(80);
    expect(rebalanceLocked(EVEN_SPLIT, 1, 100, L(0))).toEqual([20, 80, 0, 0, 0]);
  });

  it('a locked stat never moves, whichever dial is dragged', () => {
    let alloc: Allocation = [30, 25, 15, 10, 20];
    const locks = L(2, 4);
    for (const [k, t] of [[0, 60], [1, 0], [3, 45], [0, 5], [1, 70]] as const) {
      alloc = rebalanceLocked(alloc, k, t, locks);
      expect(alloc[2]).toBe(15);
      expect(alloc[4]).toBe(20);
      expect(sum(alloc)).toBe(ALLOCATION_SUM);
    }
  });

  it('a drag on a locked stat is a no-op', () => {
    expect(rebalanceLocked(EVEN_SPLIT, 0, 90, L(0))).toBe(EVEN_SPLIT);
  });

  it('with four stats locked the fifth is fixed', () => {
    const alloc: Allocation = [10, 20, 30, 25, 15];
    expect(rebalanceLocked(alloc, 4, 0, L(0, 1, 2, 3))).toBe(alloc);
    expect(rebalanceLocked(alloc, 4, 100, L(0, 1, 2, 3))).toBe(alloc);
    expect(maxTarget(alloc, 4, L(0, 1, 2, 3))).toBe(15);
  });

  it('caps the target at what the unlocked others can give, and the dial shows the cap', () => {
    const alloc: Allocation = [40, 10, 10, 10, 30];
    const next = rebalanceLocked(alloc, 1, 100, L(0, 4));
    expect(next).toEqual([40, 30, 0, 0, 30]);
    expect(maxTarget(alloc, 1, L(0, 4))).toBe(30);
  });

  it('shares equally among the unlocked others when they are all at 0', () => {
    const alloc: Allocation = [20, 80, 0, 0, 0];
    // Drag Speed down to 20 with Strength locked: 60 goes to three stats at 0.
    expect(rebalanceLocked(alloc, 1, 20, L(0))).toEqual([20, 20, 20, 20, 20]);
    // An uneven share: 61 among three → 21, 20, 20 (first takes the extra).
    expect(rebalanceLocked([19, 81, 0, 0, 0], 1, 20, L(0))).toEqual([19, 20, 21, 20, 20]);
  });

  it('keeps sum === 100, integers only, locked values fixed, across 10,000 random drags under random locks', () => {
    let alloc: Allocation = EVEN_SPLIT;
    let locks: Locks = NO_LOCKS;
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let n = 0; n < 10_000; n++) {
      if (rand() < 0.15) {
        // Re-choose the locks now and then; at most four may be locked.
        const next = [0, 1, 2, 3, 4].map(() => rand() < 0.4);
        locks = next.filter(Boolean).length === 5 ? NO_LOCKS : next;
      }
      const k = Math.floor(rand() * 5);
      const t = Math.floor(rand() * 101);
      const before = alloc;
      alloc = rebalanceLocked(alloc, k, t, locks);
      let s = 0;
      for (let i = 0; i < 5; i++) {
        expect(Number.isInteger(alloc[i])).toBe(true);
        expect(alloc[i]).toBeGreaterThanOrEqual(0);
        if (locks[i]) expect(alloc[i]).toBe(before[i]);
        s += alloc[i];
      }
      expect(s).toBe(ALLOCATION_SUM);
      const lockedCount = locks.filter(Boolean).length;
      if (!locks[k] && lockedCount === 4) {
        // Four locked: the fifth is determined and cannot move either way.
        expect(alloc[k]).toBe(before[k]);
      } else if (!locks[k]) {
        // The dragged stat lands on the target, capped at its ceiling.
        expect(alloc[k]).toBe(Math.min(t, maxTarget(before, k, locks)));
      }
    }
  });
});
