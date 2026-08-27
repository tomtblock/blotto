import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { axisUnit, pointFor, valueForPointer, INNER_FRACTION } from './geometry';

describe('pentagon geometry', () => {
  it('axis 0 points straight up; axes are 72° apart unit vectors', () => {
    const a0 = axisUnit(0);
    expect(a0.x).toBeCloseTo(0, 10);
    expect(a0.y).toBeCloseTo(-1, 10);
    for (let i = 0; i < 5; i++) {
      const u = axisUnit(i);
      expect(Math.hypot(u.x, u.y)).toBeCloseTo(1, 10);
    }
  });

  it('value → point → value round-trips exactly (continuous, no snapping)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 100, noNaN: true }),
        fc.integer({ min: 0, max: 4 }),
        (value, axis) => {
          const p = pointFor(value, axis, 160);
          const back = valueForPointer(p.x, p.y, axis, 160);
          expect(back).toBeCloseTo(value, 6);
        }
      )
    );
  });

  it('a value of 0 still renders off-centre (the grab dead-zone)', () => {
    const p = pointFor(0, 0, 160);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(160 * INNER_FRACTION, 6);
  });

  it('dragging past the centre clamps to 0, never mirrors', () => {
    const u = axisUnit(2);
    expect(valueForPointer(-u.x * 100, -u.y * 100, 2, 160)).toBe(0);
  });

  it('overshooting the rim clamps to 100', () => {
    const u = axisUnit(1);
    expect(valueForPointer(u.x * 500, u.y * 500, 1, 160)).toBe(100);
  });
});
