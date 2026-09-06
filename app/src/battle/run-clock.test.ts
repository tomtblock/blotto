/*
 * The run clock's contract. The property that matters most is the one a
 * naive implementation gets wrong: the clock starts on the FIRST dial
 * interaction and on nothing else — not payment, not screen mount, not a
 * later interaction restarting it.
 */
import { describe, expect, it } from 'vitest';
import {
  RUN_CLOCK_BUDGET_MS,
  clockExpired,
  clockStarted,
  formatClock,
  newRunClock,
  remainingMs,
  startClock,
} from './run-clock';

const T0 = 1_757_000_000_000;

describe('the run clock', () => {
  it('shows the full 1:30 and never expires before the first interaction — a slow wallet eats nothing', () => {
    const clock = newRunClock();
    expect(clockStarted(clock)).toBe(false);
    expect(remainingMs(clock, T0)).toBe(RUN_CLOCK_BUDGET_MS);
    // An hour passes while a wallet modal sits there: still 1:30, not expired.
    expect(remainingMs(clock, T0 + 3_600_000)).toBe(RUN_CLOCK_BUDGET_MS);
    expect(clockExpired(clock, T0 + 3_600_000)).toBe(false);
  });

  it('starts once and only once — later interactions cannot restart or extend it', () => {
    const started = startClock(newRunClock(), T0);
    const again = startClock(started, T0 + 60_000);
    expect(again.startedAt).toBe(T0);
    expect(remainingMs(again, T0 + 60_000)).toBe(30_000);
  });

  it('expires at exactly the budget and remaining never goes negative', () => {
    const clock = startClock(newRunClock(), T0);
    expect(clockExpired(clock, T0 + RUN_CLOCK_BUDGET_MS - 1)).toBe(false);
    expect(clockExpired(clock, T0 + RUN_CLOCK_BUDGET_MS)).toBe(true);
    expect(remainingMs(clock, T0 + RUN_CLOCK_BUDGET_MS + 5_000)).toBe(0);
  });

  it('refuses a nonsense budget instead of making a clock that lies', () => {
    expect(() => newRunClock(0)).toThrow(/positive/);
    expect(() => newRunClock(Number.NaN)).toThrow(/positive/);
  });

  it('formats as m:ss with ceiling seconds, so 1:30 is the first thing a player ever sees', () => {
    expect(formatClock(90_000)).toBe('1:30');
    expect(formatClock(89_001)).toBe('1:30'); // ceils — the display never skips ahead
    expect(formatClock(61_000)).toBe('1:01');
    expect(formatClock(999)).toBe('0:01');
    expect(formatClock(0)).toBe('0:00');
  });
});
