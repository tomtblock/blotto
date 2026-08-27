/*
 * The roadmap 3.4 gate: "Property test (fast-check): 10k random drag
 * sequences never produce a sum ≠ 100; timeout always locks the displayed
 * integers." The first half lives here against the allocation model; the
 * timeout half is in machine.test.ts.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  ALLOCATION_SUM,
  EVEN_RAW,
  EVEN_SPLIT,
  STATS,
  assertAllocation,
  dragTo,
  normalize,
  type RawWeights,
} from './allocation';

const dragArb = fc.record({
  stat: fc.integer({ min: 0, max: STATS - 1 }),
  // The full messy range a pointer maths bug could produce: zero, tiny,
  // huge, fractional.
  value: fc.oneof(
    fc.double({ min: 0, max: 200, noNaN: true }),
    fc.double({ min: 0, max: 1e9, noNaN: true }),
    fc.constant(0)
  ),
});

describe('the client invariant (PID §4.6)', () => {
  it('10k random drag sequences: the display always sums to exactly 100', () => {
    fc.assert(
      fc.property(fc.array(dragArb, { minLength: 0, maxLength: 40 }), (drags) => {
        let raw: RawWeights = EVEN_RAW;
        for (const d of drags) {
          raw = dragTo(raw, d.stat, d.value);
          const display = normalize(raw);
          assertAllocation(display); // throws unless 5 ints ≥ 0 summing to 100
          expect(display.reduce((a, b) => a + b, 0)).toBe(ALLOCATION_SUM);
        }
      }),
      { numRuns: 10_000 }
    );
  });

  it('a drag touches only its own raw stat', () => {
    fc.assert(
      fc.property(dragArb, (d) => {
        const raw = dragTo(EVEN_RAW, d.stat, d.value);
        for (let i = 0; i < STATS; i++) {
          if (i !== d.stat) expect(raw[i]).toBe(EVEN_RAW[i]);
        }
      })
    );
  });

  it('the rounding remainder lands whole on the largest stat', () => {
    // raws 1,1,1,1,3 → scaled ~14.28×4 + 42.85 → floors 14×4 + 42 = 98,
    // remainder 2 goes to the largest (index 4): 44.
    expect(normalize([1, 1, 1, 1, 3])).toEqual([14, 14, 14, 14, 44]);
  });

  it('even split is the opening state and the reset target', () => {
    expect(normalize(EVEN_RAW)).toEqual(EVEN_SPLIT);
  });

  it('an all-zero raw state normalises to the even split, never NaN', () => {
    expect(normalize([0, 0, 0, 0, 0])).toEqual(EVEN_SPLIT);
  });

  it('rejects negative and non-finite raws at the boundary', () => {
    expect(() => normalize([-1, 20, 20, 20, 20] as never)).toThrow();
    expect(() => normalize([NaN, 20, 20, 20, 20] as never)).toThrow();
    // dragTo clamps instead — a pointer can overshoot below the axis.
    expect(dragTo(EVEN_RAW, 0, -50)[0]).toBe(0);
  });
});
