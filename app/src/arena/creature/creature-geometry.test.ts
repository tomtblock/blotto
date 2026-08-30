/*
 * Creature-geometry discipline — the fragment-geometry posture applied to
 * the arena's body generator: pure, deterministic, no randomness/clock in
 * the SOURCE, and the stat→feature mapping actually monotone (the whole
 * point is that a build is readable off the silhouette).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { normalize, type Allocation, type RawWeights } from '@/battle/allocation';
import { CREATURE_VIEWBOX, creatureSpec } from './creature-geometry';

const EVEN: Allocation = [20, 20, 20, 20, 20];

/** Arbitrary valid allocation via the REAL normalizer. */
const allocationArb = fc
  .tuple(
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 100 })
  )
  .map((raw) => normalize(raw as RawWeights));

describe('creature geometry', () => {
  it('is deterministic: the same allocation always builds the same spec', () => {
    fc.assert(
      fc.property(allocationArb, (a) => {
        expect(creatureSpec(a)).toEqual(creatureSpec(a));
      })
    );
  });

  it('different allocations build different bodies', () => {
    const a = creatureSpec([60, 10, 10, 10, 10]);
    const b = creatureSpec([10, 60, 10, 10, 10]);
    expect(a.bodyPath).not.toEqual(b.bodyPath);
  });

  it('stat → feature is monotone (higher durability, thicker rim; higher heart, bigger eyes)', () => {
    const low = creatureSpec([30, 30, 10, 20, 10]);
    const high = creatureSpec([10, 30, 30, 10, 20]);
    expect(high.rimWidth).toBeGreaterThan(low.rimWidth);
    expect(high.eyes[0].r).toBeGreaterThan(low.eyes[0].r);
    expect(high.glow.r).toBeGreaterThan(low.glow.r);
  });

  it('the body is a closed path of five curve segments through the radar vertices', () => {
    const spec = creatureSpec(EVEN);
    expect(spec.bodyPath.startsWith('M ')).toBe(true);
    expect(spec.bodyPath.endsWith(' Z')).toBe(true);
    expect(spec.bodyPath.match(/ C /g)?.length).toBe(5);
  });

  it('every feature stays inside the viewBox for every allocation', () => {
    fc.assert(
      fc.property(allocationArb, (a) => {
        const spec = creatureSpec(a);
        const coords: number[] = [];
        for (const s of [...spec.horns, ...spec.fins]) {
          for (const pair of s.points.split(' ')) {
            const [x, y] = pair.split(',').map(Number);
            coords.push(x, y);
          }
        }
        for (const e of [...spec.eyes, spec.glow]) coords.push(e.cx - e.r, e.cx + e.r, e.cy - e.r, e.cy + e.r);
        for (const ant of spec.antennae) coords.push(ant.x1, ant.y1, ant.x2, ant.y2);
        for (const c of coords) {
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(CREATURE_VIEWBOX);
        }
      })
    );
  });

  it('no randomness or clock in the geometry source (NG-007)', () => {
    const source = readFileSync(path.join(__dirname, 'creature-geometry.ts'), 'utf8');
    expect(/Math\.random|Date\.now|new Date\(/.test(source)).toBe(false);
  });
});
