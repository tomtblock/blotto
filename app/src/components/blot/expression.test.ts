import { describe, expect, it } from 'vitest';
import { REST_EXPRESSION, brows, cheeks, expressionFor, visorPath } from './expression';

const VISOR = { cx: 500, cy: 400, width: 300, height: 90, rx: 40 };

describe('the face', () => {
  it('rests in a faint smile when nothing is being dragged', () => {
    expect(expressionFor(null, 0, 1)).toEqual(REST_EXPRESSION);
    expect(expressionFor(2, 0, 1)).toEqual(REST_EXPRESSION);
    expect(expressionFor(2, 1, 0)).toEqual(REST_EXPRESSION);
  });

  it('gives each raised stat its own expression, in the fixed stat order', () => {
    const [strength, speed, heart, wit, durability] = [0, 1, 2, 3, 4].map((k) => expressionFor(k, 1, 1));
    expect(strength.squint).toBeGreaterThan(0.6); // determined
    expect(strength.browL).toBeLessThan(0);
    expect(speed.browLift).toBeGreaterThan(0.5); // eager
    expect(heart.blush).toBe(1); // glowing
    expect(heart.smile).toBe(1);
    expect(wit.browR).toBeGreaterThan(wit.browL + 20); // one brow cocked
    expect(durability.smile).toBeGreaterThan(0);
    expect(durability.squint).toBeGreaterThan(0.3);
  });

  it('winces when any stat is lowered', () => {
    for (let k = 0; k < 5; k++) {
      const e = expressionFor(k, -1, 1);
      expect(e.smile).toBeLessThan(0);
    }
  });

  it('scales between rest and the full expression with strength', () => {
    const half = expressionFor(2, 1, 0.5);
    expect(half.blush).toBeCloseTo((REST_EXPRESSION.blush + 1) / 2, 5);
    expect(half.smile).toBeCloseTo((REST_EXPRESSION.smile + 1) / 2, 5);
  });

  it('draws a closed visor path at two decimals and thins it with squint', () => {
    const rest = visorPath(VISOR, REST_EXPRESSION);
    expect(rest.startsWith('M')).toBe(true);
    expect(rest.endsWith('Z')).toBe(true);
    expect(rest).not.toMatch(/\d\.\d{3}/);
    const squinting = visorPath(VISOR, { ...REST_EXPRESSION, squint: 1 });
    // The squinting visor's vertical extent is smaller: its first V-segment
    // target sits closer to the centre line.
    const ySpan = (path: string) => {
      const ys = [...path.matchAll(/V(-?\d+\.\d+)/g)].map((m) => Number(m[1]));
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(ySpan(squinting)).toBeLessThan(ySpan(rest));
  });

  it('keeps the brows above and the cheeks below the visor, symmetric about its centre', () => {
    const b = brows(VISOR, REST_EXPRESSION);
    expect(b.left.y).toBeLessThan(VISOR.cy - VISOR.height / 2);
    expect(VISOR.cx - b.left.x).toBeCloseTo(b.right.x - VISOR.cx, 5);
    const c = cheeks(VISOR, REST_EXPRESSION);
    expect(c.left.cy).toBeGreaterThan(VISOR.cy);
    expect(VISOR.cx - c.left.cx).toBeCloseTo(c.right.cx - VISOR.cx, 5);
    expect(c.left.opacity).toBeGreaterThan(0);
    expect(cheeks(VISOR, { ...REST_EXPRESSION, blush: 0 }).left.opacity).toBe(0);
  });
});
