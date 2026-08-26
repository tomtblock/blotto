/*
 * Count-up maths guard (10.C Step 4): 0 → N over the constants' duration,
 * final value EXACT, never decreasing, always an integer in [0, N].
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CARD_COUNT_UP_DURATION_MS } from "./constants";
import { countUpValue } from "./count-up";

describe("POWER LEVEL count-up maths", () => {
  it("starts at zero", () => {
    expect(countUpValue(371, 0, CARD_COUNT_UP_DURATION_MS)).toBe(0);
    expect(countUpValue(371, -50, CARD_COUNT_UP_DURATION_MS)).toBe(0);
  });

  it("lands EXACTLY on the target at and past the duration", () => {
    expect(countUpValue(371, CARD_COUNT_UP_DURATION_MS, CARD_COUNT_UP_DURATION_MS)).toBe(371);
    expect(countUpValue(371, CARD_COUNT_UP_DURATION_MS + 1, CARD_COUNT_UP_DURATION_MS)).toBe(371);
  });

  it("zero duration (reduced motion) is the final value immediately", () => {
    expect(countUpValue(371, 0, 0)).toBe(371);
  });

  it("monotone, integer, bounded — over the whole §2a range", () => {
    fc.assert(
      fc.property(
        // POWER LEVEL range; 0 covers the trivial case.
        fc.integer({ min: 0, max: 400 }),
        fc.integer({ min: 0, max: CARD_COUNT_UP_DURATION_MS }),
        fc.integer({ min: 0, max: CARD_COUNT_UP_DURATION_MS }),
        (target, t1, t2) => {
          const [lo, hi] = t1 <= t2 ? [t1, t2] : [t2, t1];
          const vLo = countUpValue(target, lo, CARD_COUNT_UP_DURATION_MS);
          const vHi = countUpValue(target, hi, CARD_COUNT_UP_DURATION_MS);
          expect(Number.isInteger(vLo)).toBe(true);
          expect(vLo).toBeGreaterThanOrEqual(0);
          expect(vHi).toBeLessThanOrEqual(target);
          expect(vLo).toBeLessThanOrEqual(vHi);
        },
      ),
    );
  });
});
