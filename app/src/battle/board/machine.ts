/*
 * The BATTLE BOARD run machine (founder brief 2026-09-24) — a PURE reducer:
 * (state, event) -> state. No timers, no Date, no React; the board
 * component owns the wall clock and feeds `tick` events in, exactly as the
 * dial machine (../machine.ts) did. That machine stays until the board has
 * played a real pool and the switch comes out (CHANGE-2026-09-24 §6).
 *
 * WHAT A RUN IS. One board of seven fields; the player picks a troop (a
 * stat) and sends points to fields — by holding (a stream of `place +1`
 * events) or by the stepper (`place ±1/5/10/20`, `fill_field`,
 * `send_back`). A field may be LOCKED IN: frozen, and left out of the
 * buzzer spread. The budget is the MODE's (mode.ts): 100 per field in
 * easy, 700 across the board in hard.
 *
 * THE CLOCK (founder 2.3 and 5.3, 2026-09-24): three minutes, ONE clock for
 * the board. It starts on the FIRST POINT PLACED — never on arrival, never
 * on selecting a troop, never on pan or zoom. A slow wallet cannot eat it;
 * neither can looking around. The rule is shown on arrival (ReadyBanner).
 *
 * ON SUBMIT OR EXPIRY: whatever is on the board is the entry, and every
 * point not placed is spread evenly across the fields not locked in
 * (spread.ts). Deterministic, disclosed, never random (R9, PID §8.3).
 *
 * TIMINGS FOR DETECTION: the sealed payload's seven u32 slots
 * (backend/sealing/src/payload.ts) now carry, per field, the run
 * millisecond of that field's LAST change (0 if never touched) — the
 * format is unchanged, the meaning is documented there and in TECH-ARCH
 * §9's appendix. Ticks before the clock starts do not count: the run
 * millisecond is measured from the first point.
 *
 * TWO LOCK RULES the founder is asked to ratify (plan §1):
 *  - easy: a field locks only when it is Full — a half-placed lock would
 *    have nowhere to send the rest;
 *  - hard: the last unlocked field cannot lock while points remain — the
 *    spread would have nowhere to go. (spread.ts throws on exactly that,
 *    so this guard is what keeps the throw unreachable.)
 *
 * PID §4.2 said the player "never sees a 'points remaining' counter", and
 * audit A-29 removed one on that basis. The founder's ruling of 2026-09-24
 * (5.3) asks for the counter in both modes: `fieldRemaining` and
 * `boardRemaining` below exist for it. PHASE-N-REVIEW: the ruling
 * supersedes §4.2's sentence; recorded in CHANGE-2026-09-24 for the PID
 * reissue.
 */

import { STATS } from '../allocation';
import { type BoardMode, BOARD_CLOCK_BUDGET_MS, EASY_PER_FIELD, FIELDS, HARD_TOTAL, fieldCap } from './mode';
import { type Grid, fieldSum, gridSum, spreadUnplaced } from './spread';

export interface BoardReadyState {
  phase: 'ready';
  mode: BoardMode;
  budgetMs: number;
}

export interface BoardPlayState {
  phase: 'play';
  mode: BoardMode;
  /** The board as placed: seven rows of five non-negative integers. */
  grid: Grid;
  /** Locked-in fields. */
  locked: readonly boolean[];
  /** The troop in hand, or null. */
  selected: number | null;
  /** False until the first point is placed. */
  clockStarted: boolean;
  /** Run milliseconds remaining; the full budget until the clock starts. */
  remainingMs: number;
  budgetMs: number;
  /** Per field: run millisecond of its last change; 0 if untouched. */
  lastChangeMs: readonly number[];
  /** Set for one render pass after an expiry (the board says why). */
  expired: boolean;
}

export interface BoardReviewState {
  phase: 'review';
  mode: BoardMode;
  /** The entry: the board after the spread. */
  battles: readonly (readonly number[])[];
  /** The board as the player left it, before the spread — what `resume` restores. */
  placed: Grid;
  budgetMs: number;
  /** Per-field timings for the sealed payload. */
  timingsMs: readonly number[];
  /** Which fields the player had locked when the run ended. */
  locked: readonly boolean[];
  /** True when the run ended by the clock rather than by Submit. */
  expired: boolean;
  /** Run milliseconds left when submitted (0 on expiry). */
  remainingMs: number;
}

export interface BoardConfirmedState {
  phase: 'confirmed';
  mode: BoardMode;
  battles: readonly (readonly number[])[];
  timingsMs: readonly number[];
}

export type BoardState = BoardReadyState | BoardPlayState | BoardReviewState | BoardConfirmedState;

export type BoardEvent =
  /** From the ready banner: take the field. Starts nothing. */
  | { type: 'begin' }
  /** Pick a troop (a stat index), or put it down (null). Starts nothing. */
  | { type: 'select'; stat: number | null }
  /** Send `delta` points of `stat` to `field` (negative takes them back). */
  | { type: 'place'; field: number; stat: number; delta: number }
  /** Send every point still to place (this field's in easy, the board's in hard) to `stat` on `field`. */
  | { type: 'fill_field'; field: number; stat: number }
  /** Take every point of `stat` back off `field`. */
  | { type: 'send_back'; field: number; stat: number }
  | { type: 'lock'; field: number }
  | { type: 'unlock'; field: number }
  | { type: 'tick'; ms: number }
  /** The player submits early; the spread applies to what is unplaced. */
  | { type: 'submit' }
  /** From review: back to the board while time remains. */
  | { type: 'resume' }
  /** From review: confirm — the sealed submit happens outside. */
  | { type: 'confirm' };

const NO_LOCKS: readonly boolean[] = Object.freeze(Array.from({ length: FIELDS }, () => false));
const NO_TIMES: readonly number[] = Object.freeze(Array.from({ length: FIELDS }, () => 0));

export function emptyGrid(): number[][] {
  return Array.from({ length: FIELDS }, () => Array.from({ length: STATS }, () => 0));
}

export function initialBoardState(mode: BoardMode, budgetMs: number = BOARD_CLOCK_BUDGET_MS): BoardReadyState {
  return { phase: 'ready', mode, budgetMs };
}

/* ——— Derived readouts (founder 5.3) ——— */

/** Easy: points left to place on `field`. Hard: the board's points left. */
export function fieldRemaining(s: Pick<BoardPlayState, 'grid' | 'mode'>, field: number): number {
  if (s.mode === 'hard') return boardRemaining(s);
  return EASY_PER_FIELD - fieldSum(s.grid[field]);
}

/** Points left to place on the whole board. */
export function boardRemaining(s: Pick<BoardPlayState, 'grid' | 'mode'>): number {
  if (s.mode === 'hard') return HARD_TOTAL - gridSum(s.grid);
  return EASY_PER_FIELD * FIELDS - gridSum(s.grid);
}

/** Easy: the field holds exactly 100. Hard: always false (no per-field cap). */
export function fieldFull(s: Pick<BoardPlayState, 'grid' | 'mode'>, field: number): boolean {
  return s.mode === 'easy' && fieldSum(s.grid[field]) === EASY_PER_FIELD;
}

/** Everything placed: 7/7 full in easy, 0 left in hard. */
export function boardComplete(s: Pick<BoardPlayState, 'grid' | 'mode'>): boolean {
  return boardRemaining(s) === 0;
}

/** Whether `lock` would be accepted right now (the two lock rules). */
export function canLock(s: Pick<BoardPlayState, 'grid' | 'mode' | 'locked'>, field: number): boolean {
  if (!validField(field) || s.locked[field]) return false;
  if (s.mode === 'easy') return fieldFull(s, field);
  if (boardRemaining(s) === 0) return true;
  // Some OTHER field must stay open for the spread to land on.
  for (let f = 0; f < FIELDS; f++) if (f !== field && !s.locked[f]) return true;
  return false;
}

/* ——— Helpers ——— */

function validField(f: number): boolean {
  return Number.isInteger(f) && f >= 0 && f < FIELDS;
}
function validStat(z: number): boolean {
  return Number.isInteger(z) && z >= 0 && z < STATS;
}

function runMs(s: BoardPlayState): number {
  return s.budgetMs - s.remainingMs;
}

/** Write one cell, stamping the field's last-change time and starting the clock. */
function withCell(s: BoardPlayState, field: number, stat: number, value: number): BoardPlayState {
  const grid = s.grid.map((row, f) => (f === field ? row.map((v, z) => (z === stat ? value : v)) : row));
  const lastChangeMs = s.lastChangeMs.map((t, f) => (f === field ? runMs(s) : t));
  return { ...s, grid, lastChangeMs, clockStarted: true };
}

function finish(s: BoardPlayState, expired: boolean): BoardReviewState {
  const battles = spreadUnplaced(s.grid, s.locked, s.mode);
  return {
    phase: 'review',
    mode: s.mode,
    battles,
    placed: s.grid,
    budgetMs: s.budgetMs,
    timingsMs: s.lastChangeMs,
    locked: s.locked,
    expired,
    remainingMs: expired ? 0 : s.remainingMs,
  };
}

/* ——— The reducer. Total: unknown (state, event) pairs return the state unchanged. ——— */

export function reduceBoard(state: BoardState, event: BoardEvent): BoardState {
  switch (state.phase) {
    case 'ready':
      if (event.type === 'begin') {
        return {
          phase: 'play',
          mode: state.mode,
          grid: emptyGrid(),
          locked: NO_LOCKS,
          selected: null,
          clockStarted: false,
          remainingMs: state.budgetMs,
          budgetMs: state.budgetMs,
          lastChangeMs: NO_TIMES,
          expired: false,
        };
      }
      return state;

    case 'play':
      switch (event.type) {
        case 'select': {
          if (event.stat !== null && !validStat(event.stat)) return state;
          return { ...state, selected: event.stat };
        }
        case 'place': {
          const { field, stat, delta } = event;
          if (!validField(field) || !validStat(stat) || !Number.isInteger(delta) || delta === 0) return state;
          if (state.locked[field]) return state;
          const cur = state.grid[field][stat];
          // The cell may grow by what is left (this field's in easy, the
          // board's in hard) and shrink to zero — never overshoot either way.
          const headroom = fieldRemaining(state, field);
          const next = Math.max(0, Math.min(cur + delta, cur + headroom, fieldCap(state.mode)));
          if (next === cur) return state;
          return withCell(state, field, stat, next);
        }
        case 'fill_field': {
          const { field, stat } = event;
          if (!validField(field) || !validStat(stat) || state.locked[field]) return state;
          const headroom = fieldRemaining(state, field);
          if (headroom === 0) return state;
          return withCell(state, field, stat, state.grid[field][stat] + headroom);
        }
        case 'send_back': {
          const { field, stat } = event;
          if (!validField(field) || !validStat(stat) || state.locked[field]) return state;
          if (state.grid[field][stat] === 0) return state;
          return withCell(state, field, stat, 0);
        }
        case 'lock': {
          if (!canLock(state, event.field)) return state;
          const locked = state.locked.map((v, f) => (f === event.field ? true : v));
          return { ...state, locked };
        }
        case 'unlock': {
          if (!validField(event.field) || !state.locked[event.field]) return state;
          const locked = state.locked.map((v, f) => (f === event.field ? false : v));
          return { ...state, locked };
        }
        case 'tick': {
          if (!(event.ms > 0)) return state;
          // Before the first point the clock holds at the full budget —
          // the player may look around for as long as they like.
          if (!state.clockStarted) return state;
          const remainingMs = state.remainingMs - event.ms;
          if (remainingMs <= 0) return finish({ ...state, remainingMs: 0, expired: true }, true);
          return { ...state, remainingMs };
        }
        case 'submit':
          // Submit is meaningful once the clock runs; before the first
          // point there is nothing to submit and the button is not shown.
          if (!state.clockStarted) return state;
          return finish(state, false);
        default:
          return state;
      }

    case 'review':
      if (event.type === 'confirm') {
        return { phase: 'confirmed', mode: state.mode, battles: state.battles, timingsMs: state.timingsMs };
      }
      if (event.type === 'resume' && !state.expired && state.remainingMs > 0) {
        // Back to the board with the PLACED grid — the spread was never
        // the player's placement, so it is not carried back. Locks and
        // times are kept; the clock resumes where it stopped.
        return {
          phase: 'play',
          mode: state.mode,
          grid: state.placed,
          locked: state.locked,
          selected: null,
          clockStarted: true,
          remainingMs: state.remainingMs,
          budgetMs: state.budgetMs,
          lastChangeMs: state.timingsMs,
          expired: false,
        };
      }
      return state;

    case 'confirmed':
      return state;
  }
}

export { FIELDS, STATS };
export type { BoardMode };
