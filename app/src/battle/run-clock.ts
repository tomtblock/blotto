/*
 * The run clock (v4, founder-directed 2026-09-06): ONE 90-second budget for
 * all seven battles, replacing R9's per-screen presentation. Pure — no
 * timers, no Date, no React — like machine.ts beside it; the screen owns
 * time and feeds `now` in.
 *
 * SEMANTICS, exactly as the brief fixes them:
 *  - The clock is a UX default, NOT a scoring rule. Nothing about the
 *    allocation's validity depends on it; expiry changes which values get
 *    locked, never whether they are legal.
 *  - It starts on the player's FIRST dial interaction after payment
 *    confirmation — never on confirmation itself. A slow wallet must not
 *    eat the clock. `start` is idempotent: later interactions cannot
 *    restart or extend it.
 *  - On expiry, every battle not yet locked locks at its current
 *    allocation (the even split if untouched). That wiring lives with the
 *    run orchestration; this module only answers "has it expired?"
 *    truthfully and immutably.
 *
 * STATUS OF THE OLD RULE: R9 ("per-screen timer: 15 seconds") and the
 * on-chain `Pool.timer_seconds` field remain ratified and untouched
 * on-chain; the client simply no longer presents time per screen. The
 * rules-page copy is NOT changed by this module or its consumers until
 * counsel signs off — the brief says so explicitly.
 */

export const RUN_CLOCK_BUDGET_MS = 90_000;

export interface RunClock {
  readonly budgetMs: number;
  /** Epoch ms of the first dial interaction, or null before it. */
  readonly startedAt: number | null;
}

export function newRunClock(budgetMs: number = RUN_CLOCK_BUDGET_MS): RunClock {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new Error(`run clock budget must be a positive number of ms, got ${budgetMs}`);
  }
  return { budgetMs, startedAt: null };
}

/** First interaction starts it; every later call is a no-op by design. */
export function startClock(clock: RunClock, now: number): RunClock {
  if (clock.startedAt !== null) return clock;
  return { ...clock, startedAt: now };
}

export function clockStarted(clock: RunClock): boolean {
  return clock.startedAt !== null;
}

/** Remaining ms: the full budget before the first interaction, never negative after. */
export function remainingMs(clock: RunClock, now: number): number {
  if (clock.startedAt === null) return clock.budgetMs;
  return Math.max(0, clock.budgetMs - (now - clock.startedAt));
}

export function clockExpired(clock: RunClock, now: number): boolean {
  return clock.startedAt !== null && now - clock.startedAt >= clock.budgetMs;
}

/** m:ss for the stopwatch readout. Tabular digits are the display's job. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
