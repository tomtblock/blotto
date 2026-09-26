/*
 * The buzzer rule (founder ruling 2026-09-24, answer 5.3): when the board
 * is submitted — by the player or by the clock — every point NOT yet placed
 * is spread evenly across the cells of the fields that are NOT locked in,
 * the indivisible remainder going one point at a time in the fixed order
 * (field 1 stat 1, field 1 stat 2, … field 7 stat 5), unlocked fields only.
 *
 *   easy — each unlocked field spreads ITS OWN unplaced points across its
 *          five stats. An untouched field becomes 20/20/20/20/20, which is
 *          exactly the R9-b rule the dials played by.
 *   hard — the board's unplaced points spread across every cell of every
 *          unlocked field.
 *
 * DETERMINISTIC, INTEGER-ONLY, NEVER RANDOM (R9, PID §8.3): the same board
 * and the same locks always give the same entry. A locked field is never
 * touched — that is what locking means.
 *
 * Pure: no I/O, no Date, no React.
 */

import { STATS } from '../allocation';
import { type BoardMode, EASY_PER_FIELD, FIELDS, HARD_TOTAL } from './mode';

/** Seven rows of five non-negative integers — the board as placed. */
export type Grid = readonly (readonly number[])[];

export function fieldSum(row: readonly number[]): number {
  let s = 0;
  for (const v of row) s += v;
  return s;
}

export function gridSum(grid: Grid): number {
  let s = 0;
  for (const row of grid) s += fieldSum(row);
  return s;
}

/** Points still to place on the board under `mode`. */
export function unplaced(grid: Grid, mode: BoardMode): number {
  if (mode === 'hard') return HARD_TOTAL - gridSum(grid);
  let r = 0;
  for (const row of grid) r += EASY_PER_FIELD - fieldSum(row);
  return r;
}

/**
 * Spread `points` evenly across the given cells IN ORDER, remainder to the
 * first cells. Returns the increments, one per cell.
 */
function evenIncrements(points: number, cells: number): number[] {
  if (cells === 0) return [];
  const base = Math.floor(points / cells);
  const extra = points - base * cells;
  const out: number[] = new Array<number>(cells);
  for (let i = 0; i < cells; i++) out[i] = base + (i < extra ? 1 : 0);
  return out;
}

/**
 * Apply the buzzer rule. `locked[f]` is true for a locked field. Returns a
 * NEW grid; the input is never mutated.
 *
 * Preconditions the reducer guarantees (asserted here so a caller that
 * breaks them fails loudly rather than silently mis-spreading):
 *  - every cell is a non-negative integer;
 *  - easy: no field exceeds 100; hard: the board does not exceed 700;
 *  - hard: if every field is locked, nothing is unplaced (the reducer
 *    refuses to lock the last field while points remain).
 */
export function spreadUnplaced(grid: Grid, locked: readonly boolean[], mode: BoardMode): number[][] {
  if (grid.length !== FIELDS || locked.length !== FIELDS) {
    throw new Error(`spread needs ${FIELDS} fields, got ${grid.length}/${locked.length}`);
  }
  const out = grid.map((row) => {
    if (row.length !== STATS) throw new Error(`a field has ${row.length} stats, expected ${STATS}`);
    for (const v of row) {
      if (!Number.isInteger(v) || v < 0) throw new Error(`cell must be a non-negative integer, got ${v}`);
    }
    return [...row];
  });

  if (mode === 'easy') {
    for (let f = 0; f < FIELDS; f++) {
      const sum = fieldSum(out[f]);
      if (sum > EASY_PER_FIELD) throw new Error(`field ${f + 1} holds ${sum} > ${EASY_PER_FIELD}`);
      if (locked[f]) continue;
      const inc = evenIncrements(EASY_PER_FIELD - sum, STATS);
      for (let z = 0; z < STATS; z++) out[f][z] += inc[z];
    }
    return out;
  }

  const total = gridSum(out);
  if (total > HARD_TOTAL) throw new Error(`board holds ${total} > ${HARD_TOTAL}`);
  const remaining = HARD_TOTAL - total;
  if (remaining === 0) return out;
  const open: number[] = [];
  for (let f = 0; f < FIELDS; f++) if (!locked[f]) open.push(f);
  if (open.length === 0) {
    throw new Error(`${remaining} points unplaced with every field locked — the reducer must refuse that lock`);
  }
  const inc = evenIncrements(remaining, open.length * STATS);
  let i = 0;
  for (const f of open) for (let z = 0; z < STATS; z++) out[f][z] += inc[i++];
  return out;
}
