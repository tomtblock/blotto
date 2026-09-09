import { describe, expect, it } from 'vitest';
import { stepThermals } from './dial-thermals';
import type { Allocation } from '@/battle/allocation';

const EVEN: Allocation = [20, 20, 20, 20, 20];

describe('dial temperature', () => {
  it('heats a stat that rose and cools the stats that gave way', () => {
    const next: Allocation = [40, 15, 15, 15, 15];
    const t = stepThermals([0, 0, 0, 0, 0], EVEN, next, 0);
    expect(t[0]).toBeGreaterThan(0);
    for (const k of [1, 2, 3, 4]) expect(t[k]).toBeLessThan(0);
  });

  it('clamps to the unit range and decays back to exactly zero', () => {
    const hot = stepThermals([0.9, 0, 0, 0, 0], EVEN, [100, 0, 0, 0, 0], 0);
    expect(hot[0]).toBe(1);
    expect(hot[1]).toBe(-1);
    let t = hot;
    for (let i = 0; i < 40; i++) t = stepThermals(t, EVEN, EVEN, 0.05);
    expect(t).toEqual([0, 0, 0, 0, 0]);
  });

  it('is neutral when nothing changed and no time passed', () => {
    expect(stepThermals([0, 0, 0, 0, 0], EVEN, EVEN, 0)).toEqual([0, 0, 0, 0, 0]);
  });
});
