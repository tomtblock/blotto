/*
 * The buzzer rule, pinned by hand-computed vectors (founder 5.3,
 * 2026-09-24): unplaced points spread evenly across the cells of the
 * fields NOT locked in, remainder in fixed order. Deterministic; a locked
 * field is never touched.
 */
import { describe, expect, it } from 'vitest';
import { EASY_PER_FIELD, FIELDS, HARD_TOTAL } from './mode';
import { fieldSum, gridSum, spreadUnplaced, unplaced } from './spread';

const L = (...locked: number[]) => Array.from({ length: FIELDS }, (_, f) => locked.includes(f));
const empty = () => Array.from({ length: FIELDS }, () => [0, 0, 0, 0, 0]);

describe('easy — each unlocked field spreads its own remainder', () => {
  it('an untouched field becomes the even split (the R9-b rule the dials played by)', () => {
    const out = spreadUnplaced(empty(), L(), 'easy');
    for (const row of out) expect(row).toEqual([20, 20, 20, 20, 20]);
  });

  it('a partly placed field spreads what is left, remainder to the first stats', () => {
    const g = empty();
    g[1] = [0, 0, 0, 74, 0]; // 26 left: 5 each, +1 to the first stat
    const out = spreadUnplaced(g, L(), 'easy');
    expect(out[1]).toEqual([6, 5, 5, 79, 5]);
    expect(fieldSum(out[1])).toBe(EASY_PER_FIELD);
  });

  it('the prototype\'s own vector: 5 on Durability → 19/19/19/19/24', () => {
    const g = empty();
    g[6] = [0, 0, 0, 0, 5]; // 95 left → 19 each
    expect(spreadUnplaced(g, L(), 'easy')[6]).toEqual([19, 19, 19, 19, 24]);
  });

  it('a locked field is untouched even when it is not full (defensive: the reducer never allows it)', () => {
    const g = empty();
    g[2] = [10, 0, 0, 0, 0];
    const out = spreadUnplaced(g, L(2), 'easy');
    expect(out[2]).toEqual([10, 0, 0, 0, 0]);
    expect(out[3]).toEqual([20, 20, 20, 20, 20]);
  });

  it('a full field is unchanged', () => {
    const g = empty();
    g[0] = [0, 0, 0, 100, 0];
    expect(spreadUnplaced(g, L(), 'easy')[0]).toEqual([0, 0, 0, 100, 0]);
  });

  it('does not mutate its input', () => {
    const g = empty();
    spreadUnplaced(g, L(), 'easy');
    expect(g[0]).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('hard — the board\'s remainder spreads across every unlocked cell', () => {
  it('an empty board becomes 20 in every cell', () => {
    const out = spreadUnplaced(empty(), L(), 'hard');
    for (const row of out) expect(row).toEqual([20, 20, 20, 20, 20]);
    expect(gridSum(out)).toBe(HARD_TOTAL);
  });

  it('spreads 312 left across 35 cells: 8 each, +1 to the first 32 in fixed order', () => {
    const g = empty();
    g[0] = [23, 0, 0, 0, 0];
    g[1] = [180, 0, 0, 131, 0];
    g[4] = [0, 0, 0, 0, 54];
    expect(unplaced(g, 'hard')).toBe(312);
    const out = spreadUnplaced(g, L(), 'hard');
    // 312 = 8 × 35 + 32 → the first 32 cells get 9, the last 3 get 8.
    expect(out[0]).toEqual([32, 9, 9, 9, 9]);
    expect(out[1]).toEqual([189, 9, 9, 140, 9]);
    expect(out[6]).toEqual([9, 9, 8, 8, 8]);
    expect(gridSum(out)).toBe(HARD_TOTAL);
  });

  it('skips locked fields and lands the remainder on the open ones only', () => {
    const g = empty();
    g[1] = [300, 0, 0, 0, 0];
    g[3] = [0, 0, 0, 100, 0];
    // 300 left; fields 2 and 4 (indices 1, 3) locked → 25 open cells → 12 each
    const out = spreadUnplaced(g, L(1, 3), 'hard');
    expect(out[1]).toEqual([300, 0, 0, 0, 0]);
    expect(out[3]).toEqual([0, 0, 0, 100, 0]);
    expect(out[0]).toEqual([12, 12, 12, 12, 12]);
    expect(out[6]).toEqual([12, 12, 12, 12, 12]);
    expect(gridSum(out)).toBe(HARD_TOTAL);
  });

  it('refuses the state the reducer forbids: everything locked with points unplaced', () => {
    const g = empty();
    g[0] = [1, 0, 0, 0, 0];
    expect(() => spreadUnplaced(g, L(0, 1, 2, 3, 4, 5, 6), 'hard')).toThrow(/every field locked/);
  });

  it('a complete board is returned unchanged', () => {
    const g = empty();
    g[0] = [700, 0, 0, 0, 0];
    expect(spreadUnplaced(g, L(), 'hard')[0]).toEqual([700, 0, 0, 0, 0]);
  });
});

describe('guards', () => {
  it('refuses a non-integer or negative cell', () => {
    const g = empty();
    g[0] = [1.5, 0, 0, 0, 0];
    expect(() => spreadUnplaced(g, L(), 'easy')).toThrow(/non-negative integer/);
    g[0] = [-1, 0, 0, 0, 0];
    expect(() => spreadUnplaced(g, L(), 'hard')).toThrow(/non-negative integer/);
  });
  it('refuses a field over 100 in easy and a board over 700 in hard', () => {
    const g = empty();
    g[0] = [101, 0, 0, 0, 0];
    expect(() => spreadUnplaced(g, L(), 'easy')).toThrow(/> 100/);
    g[0] = [701, 0, 0, 0, 0];
    expect(() => spreadUnplaced(g, L(), 'hard')).toThrow(/> 700/);
  });
});
