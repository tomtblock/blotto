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
  sampleTick,
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

  /*
   * F-04 (audit 2026-09-11). The screen counted setInterval FIRINGS × 100 ms
   * instead of elapsed time, so a throttled or backgrounded tab — browsers
   * throttle background timers to about one per second, less on mobile —
   * bought arbitrary extra deliberation, with the on-screen clock agreeing.
   * Every player is scored against every other, so time one player gains is
   * taken from the rest of the field.
   */
  describe('sampling elapsed time (F-04)', () => {
    it('reports the WHOLE span a throttled tab skipped, not one tick', () => {
      // The old behaviour: 100 ms per firing however long the gap was.
      const sample = sampleTick(1000, 1000 + 60_000);
      expect(sample.ms).toBe(60_000);
      expect(sample.baseline).toBe(61_000);
    });

    it('reports whole milliseconds — the sealed payload refuses anything else', () => {
      // encodePayload throws on a non-integer timing (u32 per screen), and
      // it throws at the SEAL, after the ninety seconds are spent.
      for (const now of [1000.4, 1099.9, 1000.0001, 1234.5678]) {
        expect(Number.isInteger(sampleTick(1000, now).ms), String(now)).toBe(true);
      }
    });

    it('loses nothing to rounding over a whole run', () => {
      // 900 samples of 100.1 ms is 90.09 s of real time. Flooring each
      // sample independently would throw away 0.1 ms ninety times a
      // second — about 90 ms a minute of free deliberation.
      let baseline = 0;
      let total = 0;
      for (let i = 1; i <= 900; i++) {
        const sample = sampleTick(baseline, i * 100.1);
        baseline = sample.baseline;
        total += sample.ms;
      }
      expect(total).toBe(Math.floor(900 * 100.1));
      expect(900 * 100.1 - total).toBeLessThan(1);
    });

    it('never rewinds the run on a backwards or nonsense reading', () => {
      expect(sampleTick(1000, 900)).toEqual({ ms: 0, baseline: 1000 });
      expect(sampleTick(1000, 1000)).toEqual({ ms: 0, baseline: 1000 });
      expect(sampleTick(1000, Number.NaN).ms).toBe(0);
    });

    it('is equivalent whether time arrives in one sample or many', () => {
      // The property the fix rests on: the reducer is delta-driven, so a
      // throttled tab and a foreground tab spend the same budget.
      const one = sampleTick(0, 5_000).ms;
      let baseline = 0;
      let many = 0;
      for (let i = 1; i <= 50; i++) {
        const sample = sampleTick(baseline, i * 100);
        baseline = sample.baseline;
        many += sample.ms;
      }
      expect(many).toBe(one);
    });
  });

  it('formats as m:ss with ceiling seconds, so 1:30 is the first thing a player ever sees', () => {
    expect(formatClock(90_000)).toBe('1:30');
    expect(formatClock(89_001)).toBe('1:30'); // ceils — the display never skips ahead
    expect(formatClock(61_000)).toBe('1:01');
    expect(formatClock(999)).toBe('0:01');
    expect(formatClock(0)).toBe('0:00');
  });
});
