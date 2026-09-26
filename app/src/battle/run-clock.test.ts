/*
 * The run clock helpers' contract (run-clock.ts): elapsed time sampled as
 * whole, drift-free milliseconds, and the m:ss readout. The board's own
 * start-on-first-point and expiry rules are pinned in
 * battle/board/machine.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { formatClock, sampleTick } from './run-clock';

describe('the run clock', () => {
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
      // encodePayload throws on a non-integer timing (u32 per field), and
      // it throws at the SEAL, after the run is spent.
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

  it('formats as m:ss with ceiling seconds, so 3:00 is the first thing a player ever sees', () => {
    expect(formatClock(180_000)).toBe('3:00');
    expect(formatClock(179_001)).toBe('3:00'); // ceils — the display never skips ahead
    expect(formatClock(90_000)).toBe('1:30');
    expect(formatClock(61_000)).toBe('1:01');
    expect(formatClock(999)).toBe('0:01');
    expect(formatClock(0)).toBe('0:00');
  });
});
