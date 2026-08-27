/*
 * The seven-battle flow machine (roadmap 3.4; PID §4, R9) — a PURE reducer:
 * (state, event) -> state. No timers, no Date, no React; the screen
 * component owns the clock and feeds `tick` events in, exactly the carried
 * reveal machine's discipline (src/reveal/machine.ts).
 *
 * Screens: battle 0..6 → review → confirmed (terminal — the sealed submit
 * happens outside, on the state's frozen output).
 *
 * R9, verbatim from the register: "Per-screen timer: 15 seconds, visible.
 * On timeout, the battle locks in whatever the pentagon currently shows
 * (20-20-20-20-20 if untouched)." The founder's randomise-on-timeout
 * instinct was REJECTED — recorded in R9 — because it inserts chance into
 * the scoring mechanism and breaks PID §8.3. Lock-current is deterministic,
 * is the player's own inaction, and is disclosed in the rules. Do not
 * reintroduce randomisation here, ever.
 *
 * Timing capture: milliseconds of visible time per locked screen, capped at
 * the timer budget by construction. Travels inside the sealed payload for
 * the detection layer (TECH-ARCH §9); revealed with everything else at
 * close.
 */

import {
  EVEN_RAW,
  normalize,
  dragTo,
  type Allocation,
  type RawWeights,
} from './allocation';

export const BATTLES = 7;
/** R9 default; the live value comes from `Pool.timer_seconds` on-chain. */
export const DEFAULT_TIMER_SECONDS = 15;

export interface BattleScreenState {
  phase: 'battle';
  /** 0-based battle index. */
  screen: number;
  raw: RawWeights;
  /** The REAL allocation — what locks on lock-in or timeout. */
  display: Allocation;
  /** Milliseconds elapsed on this screen. */
  elapsedMs: number;
  /** Milliseconds remaining before lock-current fires. */
  remainingMs: number;
  /** Battles locked so far. */
  locked: readonly Allocation[];
  /** Per-screen timings locked so far. */
  timingsMs: readonly number[];
  timerBudgetMs: number;
}

export interface ReviewState {
  phase: 'review';
  battles: readonly Allocation[];
  timingsMs: readonly number[];
  timerBudgetMs: number;
}

export interface ConfirmedState {
  phase: 'confirmed';
  battles: readonly Allocation[];
  timingsMs: readonly number[];
}

export type BattleFlowState = BattleScreenState | ReviewState | ConfirmedState;

export type BattleFlowEvent =
  | { type: 'drag'; stat: number; value: number }
  | { type: 'even_split' }
  | { type: 'tick'; ms: number }
  | { type: 'lock_in' }
  /** From review only: go back and re-play a screen is NOT offered — the
   * review screen confirms or abandons (decisions are final, PID §8.6). */
  | { type: 'confirm' };

export function initialState(timerSeconds: number = DEFAULT_TIMER_SECONDS): BattleScreenState {
  return freshScreen(0, [], [], timerSeconds * 1000);
}

function freshScreen(
  screen: number,
  locked: readonly Allocation[],
  timingsMs: readonly number[],
  timerBudgetMs: number
): BattleScreenState {
  return {
    phase: 'battle',
    screen,
    raw: EVEN_RAW,
    display: normalize(EVEN_RAW),
    elapsedMs: 0,
    remainingMs: timerBudgetMs,
    locked,
    timingsMs,
    timerBudgetMs,
  };
}

/** Lock the CURRENT DISPLAYED integers (used by lock-in AND timeout — R9). */
function lockCurrent(s: BattleScreenState): BattleFlowState {
  const locked = [...s.locked, s.display];
  const timings = [...s.timingsMs, Math.min(s.elapsedMs, s.timerBudgetMs)];
  if (locked.length === BATTLES) {
    return {
      phase: 'review',
      battles: locked,
      timingsMs: timings,
      timerBudgetMs: s.timerBudgetMs,
    };
  }
  return freshScreen(s.screen + 1, locked, timings, s.timerBudgetMs);
}

/** The reducer. Total: unknown (state, event) pairs return the state unchanged. */
export function reduce(state: BattleFlowState, event: BattleFlowEvent): BattleFlowState {
  switch (state.phase) {
    case 'battle':
      switch (event.type) {
        case 'drag': {
          const raw = dragTo(state.raw, event.stat, event.value);
          return { ...state, raw, display: normalize(raw) };
        }
        case 'even_split':
          return { ...state, raw: EVEN_RAW, display: normalize(EVEN_RAW) };
        case 'tick': {
          if (!(event.ms > 0)) return state;
          const elapsedMs = state.elapsedMs + event.ms;
          const remainingMs = state.remainingMs - event.ms;
          if (remainingMs <= 0) {
            // R9: lock whatever the pentagon currently shows. Deterministic.
            return lockCurrent({ ...state, elapsedMs: state.timerBudgetMs, remainingMs: 0 });
          }
          return { ...state, elapsedMs, remainingMs };
        }
        case 'lock_in':
          return lockCurrent(state);
        default:
          return state;
      }
    case 'review':
      if (event.type === 'confirm') {
        return { phase: 'confirmed', battles: state.battles, timingsMs: state.timingsMs };
      }
      return state;
    case 'confirmed':
      return state;
  }
}
