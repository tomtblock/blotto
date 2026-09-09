import { describe, expect, it } from 'vitest';
import { EVEN_SPLIT } from '@/battle/allocation';
import { fitFor, glowFor, radialFactors } from './warp';

describe('radialFactors — the readout the render is pushed through', () => {
  it('is exactly 1 on every corner at the even split', () => {
    for (const f of radialFactors(EVEN_SPLIT)) expect(f).toBeCloseTo(1, 9);
  });

  it('grows with the stat and shrinks below it, monotonically', () => {
    const at = (v: number) => radialFactors([v, 20, 20, 20, 20])[0];
    expect(at(0)).toBeLessThan(at(10));
    expect(at(10)).toBeLessThan(at(20));
    expect(at(20)).toBeLessThan(at(60));
    expect(at(60)).toBeLessThan(at(100));
  });

  it('keeps a 100-point spike a picture rather than a smear (softer than the vector reach)', () => {
    const [top] = radialFactors([100, 0, 0, 0, 0]);
    expect(top).toBeGreaterThan(1.8);
    expect(top).toBeLessThan(2.4);
  });

  it('maps corners in the fixed stat order: Strength first', () => {
    const f = radialFactors([60, 10, 10, 10, 10]);
    expect(f[0]).toBeGreaterThan(f[1]);
    expect(f[1]).toBeCloseTo(f[2], 9);
  });
});

describe('fitFor', () => {
  it('leaves ordinary shapes at full size and zooms out only for a spike', () => {
    expect(fitFor(radialFactors(EVEN_SPLIT))).toBe(1);
    expect(fitFor(radialFactors([100, 0, 0, 0, 0]))).toBeLessThan(1);
  });
});

describe('glowFor', () => {
  it('is 0 at the even split, warm above it, cool below it', () => {
    expect(glowFor(20)).toBe(0);
    expect(glowFor(100)).toBe(1);
    expect(glowFor(0)).toBeLessThan(0);
    expect(glowFor(0)).toBeGreaterThanOrEqual(-0.6);
  });
});
