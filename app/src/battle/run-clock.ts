/*
 * The run clock's two pure helpers. Pure — no timers, no Date, no React;
 * the board (components/board/BoardFlow.tsx) owns time and feeds `now` in,
 * and its reducer (battle/board/machine.ts) carries the remaining time in
 * its own state, advanced by `tick` events. The budget is the board's
 * `BOARD_CLOCK_BUDGET_MS` (battle/board/mode.ts, three minutes — founder
 * 2026-09-24), and the clock starts on the first point placed.
 *
 *  - `sampleTick` — how the board turns `performance.now()` into those
 *    tick deltas (audit 2026-09-11, F-04).
 *  - `formatClock` — the m:ss readout on the clock plaque and the review.
 *
 * (Until 2026-09-24 this module also held the dial run's 90-second budget
 * and a timestamp-based `RunClock` value type used only by the dev gallery.
 * Both left with the dial run.)
 */

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
 *  - INTEGER milliseconds. The per-field timings travel in the sealed
 *    payload as u32s, and `encodePayload` throws on a non-integer
 *    (backend/sealing/src/payload.ts) — a float here would fail the entry
 *    at the seal, after the run is spent.
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

/** m:ss for the clock readout. Tabular digits are the display's job. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
