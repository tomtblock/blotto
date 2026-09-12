/*
 * The seven-battle RUN machine (v4, founder brief 2026-09-06) — a PURE
 * reducer: (state, event) -> state. No timers, no Date, no React; the
 * screen component owns the wall clock and feeds `tick` events in.
 *
 * v4 TIMER SEMANTICS, superseding the per-screen presentation of R9's
 * value: ONE 90-second clock for the whole run. It starts on the player's
 * FIRST dial interaction — never on payment confirmation, so a slow
 * wallet cannot eat the clock — and runs through lock-ins and screen
 * advances. The per-battle ~13 s guide is advisory display only and does
 * not exist here. `Pool.timer_seconds` (R9) is untouched on-chain; the
 * rules-page copy change is with counsel (master prompt, founder open
 * item).
 *
 * ON EXPIRY: every battle NOT LOCKED IN — the one on screen included,
 * whatever shape its dials had — is entered as the EVEN SPLIT. Only
 * `lock_in` records a shape.
 *
 * This paragraph said the opposite until 2026-09-11 (audit F-15): "the
 * current battle locks at exactly what it shows". That was the v4 brief's
 * original rule, and the founder's R9-b addendum of 2026-09-07 replaced it
 * — `lockAllRemaining` below has implemented the addendum since, and cites
 * it. The DOC was the stale half, so the doc is what changed here: the
 * behaviour is founder-owned and ratified, and a reducer edited to match a
 * superseded comment would have silently reverted a founder ruling.
 * Pinned by machine.test.ts ("keeps every locked battle; the on-screen
 * battle and every untouched one enter as the even split").
 *
 * R9's REJECTION OF RANDOMISE-ON-TIMEOUT still binds: lock-current is
 * deterministic, is the player's own inaction, and is disclosed. Do not
 * reintroduce chance here, ever (PID §8.3).
 *
 * Screens: ready → battle 0..6 → review → confirmed (terminal — the
 * sealed submit happens outside, on the state's frozen output).
 *
 * Timing capture: milliseconds of visible time per locked screen —
 * travels inside the sealed payload for the detection layer (TECH-ARCH
 * §9); revealed with everything else at close. Battles auto-locked by
 * expiry record the time actually spent on them (0 for never-visited).
 *
 * Dial coupling: `dial` pins the dragged stat and rebalances the other
 * four proportionally (src/components/blot/rebalance.ts) — integers, sum
 * exactly 100, always.
 */

import { EVEN_SPLIT, type Allocation } from './allocation';
import { rebalance } from '@/components/blot/rebalance';
import { RUN_CLOCK_BUDGET_MS } from './run-clock';

export const BATTLES = 7;

export interface ReadyState {
  phase: 'ready';
  budgetMs: number;
}

export interface BattleScreenState {
  phase: 'battle';
  /** 0-based battle index. */
  screen: number;
  /** The live allocation for THIS screen — integers summing to 100. */
  alloc: Allocation;
  /** Milliseconds of visible time on this screen. */
  screenElapsedMs: number;
  /** False until the first dial interaction of the RUN. */
  clockStarted: boolean;
  /** Run milliseconds remaining; the full budget until the clock starts. */
  remainingMs: number;
  budgetMs: number;
  /** Battles locked so far. */
  locked: readonly Allocation[];
  /** Per-screen timings locked so far. */
  timingsMs: readonly number[];
  /** Set for one render pass after an expiry lock (component shows why). */
  expired: boolean;
}

export interface ReviewState {
  phase: 'review';
  battles: readonly Allocation[];
  timingsMs: readonly number[];
  /** True when the run ended by expiry rather than a seventh lock-in. */
  expired: boolean;
}

export interface ConfirmedState {
  phase: 'confirmed';
  battles: readonly Allocation[];
  timingsMs: readonly number[];
}

export type BattleFlowState = ReadyState | BattleScreenState | ReviewState | ConfirmedState;

export type BattleFlowEvent =
  /** The Approved screen's "Make my first Blot" — enter battle 1. */
  | { type: 'begin' }
  /** A dial moved stat `stat` to `target` (0..100). Starts the run clock. */
  | { type: 'dial'; stat: number; target: number }
  | { type: 'even_split' }
  | { type: 'tick'; ms: number }
  | { type: 'lock_in' }
  /** From review only: re-playing a screen is NOT offered — the review
   * confirms or abandons (decisions are final, PID §8.6). */
  | { type: 'confirm' };

export function initialState(budgetMs: number = RUN_CLOCK_BUDGET_MS): ReadyState {
  return { phase: 'ready', budgetMs };
}

function freshScreen(
  screen: number,
  prev: Pick<BattleScreenState, 'clockStarted' | 'remainingMs' | 'budgetMs' | 'locked' | 'timingsMs'>
): BattleScreenState {
  return {
    phase: 'battle',
    screen,
    alloc: EVEN_SPLIT,
    screenElapsedMs: 0,
    clockStarted: prev.clockStarted,
    remainingMs: prev.remainingMs,
    budgetMs: prev.budgetMs,
    locked: prev.locked,
    timingsMs: prev.timingsMs,
    expired: false,
  };
}

/** Lock the CURRENT integers (lock-in AND expiry — deterministic, R9). */
function lockCurrent(s: BattleScreenState): BattleFlowState {
  const locked = [...s.locked, s.alloc];
  const timings = [...s.timingsMs, Math.min(s.screenElapsedMs, s.budgetMs)];
  if (locked.length === BATTLES) {
    return { phase: 'review', battles: locked, timingsMs: timings, expired: false };
  }
  return freshScreen(s.screen + 1, { ...s, locked, timingsMs: timings });
}

/** Expiry (R9-b, founder addendum 2026-09-07): every battle NOT locked —
 * the one on screen included, whatever shape it had — is entered as the
 * even split. Only `lock_in` records a shape; running out of time never
 * does. Deterministic: same inputs, same result, always. */
function lockAllRemaining(s: BattleScreenState): ReviewState {
  const battles = [...s.locked, EVEN_SPLIT];
  const timings = [...s.timingsMs, Math.min(s.screenElapsedMs, s.budgetMs)];
  while (battles.length < BATTLES) {
    battles.push(EVEN_SPLIT);
    timings.push(0);
  }
  return { phase: 'review', battles, timingsMs: timings, expired: true };
}

/** The reducer. Total: unknown (state, event) pairs return the state unchanged. */
export function reduce(state: BattleFlowState, event: BattleFlowEvent): BattleFlowState {
  switch (state.phase) {
    case 'ready':
      if (event.type === 'begin') {
        return freshScreen(0, {
          clockStarted: false,
          remainingMs: state.budgetMs,
          budgetMs: state.budgetMs,
          locked: [],
          timingsMs: [],
        });
      }
      return state;

    case 'battle':
      switch (event.type) {
        case 'dial': {
          const alloc = rebalance(state.alloc, event.stat, event.target);
          // The FIRST dial interaction of the run starts the clock —
          // idempotent thereafter (run-clock discipline).
          return { ...state, alloc, clockStarted: true };
        }
        case 'even_split':
          // The one quick action (PID §4.3). It does not start the clock:
          // it is the state the screen already opened in.
          return { ...state, alloc: EVEN_SPLIT };
        case 'tick': {
          if (!(event.ms > 0)) return state;
          const screenElapsedMs = state.screenElapsedMs + event.ms;
          if (!state.clockStarted) {
            // Before the first drag the run clock holds at the full
            // budget; screen time still accrues for the detection record.
            return { ...state, screenElapsedMs };
          }
          const remainingMs = state.remainingMs - event.ms;
          if (remainingMs <= 0) {
            return lockAllRemaining({ ...state, screenElapsedMs, remainingMs: 0 });
          }
          return { ...state, screenElapsedMs, remainingMs };
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
