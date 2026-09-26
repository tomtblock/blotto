/*
 * The two board MODES (founder rulings 2026-09-24): what a player has to
 * place, and where.
 *
 *   easy — seven battles, 100 points in EACH, split across the five stats.
 *          This is the rule the platform has always played (PID §4.6); the
 *          board is a new way of expressing it, not a new rule.
 *   hard — seven battles, 700 points placed ANYWHERE across the thirty-five
 *          cells. A battle may hold none of them or all of them.
 *
 * The competition mechanics are identical in both (founder 5.1): a stat is
 * won by the larger number, a battle by three of five, otherwise a draw;
 * every player faces every other. Only the placing budget differs.
 *
 * Phase A wires EASY only — it needs no program, payload or engine change.
 * HARD is carried here so the reducer and its tests cover both from day
 * one; its pool, encoding and scoring-engine invariant land in Phase B
 * (docs/architecture/ARCHITECTURE.md).
 *
 * Nothing here is invented: 100 is `ALLOCATION_SUM`, 7 is `BATTLES`, and
 * 700 is their product. The three-minute clock is a founder ruling of
 * 2026-09-24 (replacing the ninety seconds of the 2026-09-06 brief).
 */

import { ALLOCATION_SUM, STATS } from '../allocation';

export type BoardMode = 'easy' | 'hard';

/** Fields on the board — one per battle. */
export const FIELDS = 7;
/** Cells on the board: seven fields × five stats. */
export const CELLS = FIELDS * STATS;

/** Easy: the budget of ONE field. */
export const EASY_PER_FIELD = ALLOCATION_SUM;
/** Hard: the budget of the WHOLE board. */
export const HARD_TOTAL = FIELDS * ALLOCATION_SUM;

/** The three-minute run clock (founder 2026-09-24). */
export const BOARD_CLOCK_BUDGET_MS = 3 * 60 * 1000;

/** The stepper's steps, as ruled: single points first, then 5, 10, 20. */
export const STEP_SIZES = [1, 5, 10, 20] as const;

/** The whole board's budget under a mode. */
export function boardBudget(mode: BoardMode): number {
  return mode === 'easy' ? EASY_PER_FIELD * FIELDS : HARD_TOTAL;
}

/** One field's cap under a mode: 100 in easy, the whole budget in hard. */
export function fieldCap(mode: BoardMode): number {
  return mode === 'easy' ? EASY_PER_FIELD : HARD_TOTAL;
}
