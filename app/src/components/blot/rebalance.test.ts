/*
 * The dial-coupling rule, pinned to the brief's acceptance tests (§9.1–2)
 * and its worked example. The battle-critical property: whatever a dial
 * does, nothing leaves except five non-negative integers summing to
 * exactly 100 — and the dragged stat lands where the finger put it.
 */
import { describe, expect, it } from 'vitest';
import { ALLOCATION_SUM, EVEN_SPLIT, type Allocation } from '@/battle/allocation';
import { rebalance } from './rebalance';

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
