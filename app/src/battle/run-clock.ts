/*
 * The run clock (v4, founder-directed 2026-09-06): ONE 90-second budget for
 * all seven battles, replacing R9's per-screen presentation. Pure — no
 * timers, no Date, no React — like machine.ts beside it; the screen owns
 * time and feeds `now` in.
 *
 * WHAT IN HERE IS LIVE (audit 2026-09-11, F-15 — this used to read as if
 * the whole module drove the run, and it does not):
 *
 *  - `RUN_CLOCK_BUDGET_MS` — the founder-owned 90 s. machine.ts's
 *    `initialState` takes it, and the run's remaining time is carried in
 *    the REDUCER's own state (`BattleScreenState.remainingMs`), advanced by
 *    `tick` events. That is the clock the run actually runs on.
 *  - `sampleTick` — how the screen turns `performance.now()` into those
 *    tick deltas (F-04).
 *  - `formatClock` — the stopwatch readout (components/blot/Timer.tsx).
 *
 *  The `RunClock` VALUE TYPE below and its four functions (`newRunClock`,
 *  `startClock`, `clockStarted`, `clockExpired`, `remainingMs`) are an
 *  alternative, timestamp-based expression of the same rules. Nothing in
 *  the run imports them: the only consumer is the dev component gallery
 *  (`app/dev/components/page.dev.tsx` — a route that exists in development
 *  only and is not compiled into a production build at all, so these leave
 *  no bytes in a deployed bundle), plus this module's own tests. They are kept
 *  because the gallery demonstrates the clock in isolation and because the
 *  properties they state — start-once, never-negative, expiry at exactly
 *  the budget — are the specification the reducer is checked against. They
 *  are NOT a second source of truth: if the two ever disagree, the reducer
 *  is the product and these are wrong.
 *
 * SEMANTICS, exactly as the brief and the founder's 2026-09-07 addendum fix
 * them:
 *  - The clock is a UX default, NOT a scoring rule. Nothing about the
 *    allocation's validity depends on it; expiry changes which values get
 *    locked, never whether they are legal.
 *  - It starts on the player's FIRST dial interaction after payment
 *    confirmation — never on confirmation itself. A slow wallet must not
 *    eat the clock. `start` is idempotent: later interactions cannot
 *    restart or extend it.
 *  - On expiry, every battle NOT LOCKED IN — the one on screen included,
 *    whatever its dials showed — is entered as the EVEN SPLIT. This module
 *    said "locks at its current allocation" until 2026-09-11 (audit F-15),
 *    which was the pre-addendum rule and is not what `machine.ts`'s
 *    `lockAllRemaining` does. The wiring lives there; this module only
 *    answers "has it expired?" truthfully and immutably.
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

/**
 * One sample of elapsed time, for the component that drives the run
 * (audit 2026-09-11, F-04).
 *
 * The screen used to dispatch a FIXED 100 ms on every `setInterval`
 * callback, which counted TIMER FIRINGS rather than time. Browsers throttle
 * timers in a background tab to roughly one per second (less on mobile), so
 * a backgrounded or throttled tab bought arbitrary extra deliberation and
 * the clock on screen agreed with it — a competitive-integrity defect,
 * since every player is scored against every other.
 *
 * Two properties this function exists to guarantee:
 *
 *  - INTEGER milliseconds. The per-screen timings travel in the sealed
 *    payload as u32s, and `encodePayload` throws on a non-integer
 *    (backend/sealing/src/payload.ts) — a float here would fail the entry
 *    at the seal, after the ninety seconds.
 *  - NO DRIFT. The baseline advances by exactly what was reported, so the
 *    sub-millisecond remainder accrues into later samples instead of being
 *    dropped a hundred times a second.
 *
 * `now` is expected to be a monotonic reading (`performance.now()`), not a
 * wall-clock date: a device clock that moves under us must not lengthen or
 * shorten a run.
 */
export interface TickSample {
  /** Whole milliseconds elapsed since `baseline`, never negative. */
  ms: number;
  /** The baseline to carry into the next sample. */
  baseline: number;
}

export function sampleTick(baseline: number, now: number): TickSample {
  // A non-monotonic or backwards reading reports nothing rather than
  // rewinding the run.
  const elapsed = Math.floor(now - baseline);
  if (!Number.isFinite(elapsed) || elapsed <= 0) return { ms: 0, baseline };
  return { ms: elapsed, baseline: baseline + elapsed };
}

/** m:ss for the stopwatch readout. Tabular digits are the display's job. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
