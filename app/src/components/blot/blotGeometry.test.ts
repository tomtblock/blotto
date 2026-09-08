/*
 * The Blot's geometry, pinned to the brief's acceptance tests (§9.3–9.5)
 * plus the properties every renderer relies on and none re-checks.
 */
import { describe, expect, it } from 'vitest';
import {
  BASE_RADIUS,
  CENTRE_X,
  CENTRE_Y,
  REACH_CEIL,
  SHAPE_REFERENCES,
  blotCorners,
  blotScene,
  bottomAtX,
  boundaryAtY,
  cornerDistance,
  filletOf,
  outlineSegments,
  puffOf,
  sampleOutline,
} from './blotGeometry';

const R = BASE_RADIUS;

describe('corner distance', () => {
  it('renders the even split as the exact regular pentagon of the shape sheet (§9.3)', () => {
    // 20 points → r = R·(0.35 + 0.65) = R, ±1e-6. The anchor the whole
    // formula is tuned around; if it drifts, every silhouette drifts.
    expect(cornerDistance(20)).toBeCloseTo(R, 6);
    for (const p of blotCorners([20, 20, 20, 20, 20])) {
      expect(Math.hypot(p.x - CENTRE_X, p.y - CENTRE_Y)).toBeCloseTo(R, 6);
    }
  });

  it('stretches an all-in 60 to 2.3R (the Spike) and pinches 0 to 0.35R, never nothing', () => {
    expect(cornerDistance(60)).toBeCloseTo(2.3 * R, 6);
    expect(cornerDistance(0)).toBeCloseTo(0.35 * R, 6);
    expect(cornerDistance(0)).toBeGreaterThan(0);
  });

  it('clamps at 3.6R so no allocation can outgrow the stage', () => {
    expect(cornerDistance(100)).toBeCloseTo(REACH_CEIL * R, 6);
    expect(cornerDistance(999)).toBeCloseTo(REACH_CEIL * R, 6);
  });

  it('is strictly monotone in the stat — more points always reads as more reach', () => {
    let prev = -1;
    for (let v = 0; v <= 100; v += 5) {
      const r = cornerDistance(v);
      expect(r).toBeGreaterThan(prev);
      prev = r;
    }
  });
});

describe('corner order (§9.4)', () => {
  it('puts Strength at the top and proceeds clockwise in fixed stat order, for every reference', () => {
    for (const ref of SHAPE_REFERENCES) {
      const v = blotCorners(ref.allocation);
      expect(v).toHaveLength(5);
      expect(v[0].x).toBeCloseTo(CENTRE_X, 4); // STR: straight up
      expect(v[0].y).toBeLessThan(CENTRE_Y);
      expect(v[1].x).toBeGreaterThan(CENTRE_X); // SPD: upper-right
      expect(v[2].x).toBeGreaterThan(CENTRE_X); // HRT: lower-right
      expect(v[2].y).toBeGreaterThan(CENTRE_Y);
      expect(v[3].x).toBeLessThan(CENTRE_X); // WIT: lower-left
      expect(v[3].y).toBeGreaterThan(CENTRE_Y);
      expect(v[4].x).toBeLessThan(CENTRE_X); // DUR: upper-left
    }
  });
});

describe('continuity (§9.5 — no jumps, ever)', () => {
  it('moves each corner at most one radius step for a one-point transfer', () => {
    // NOTE FOR REVIEW: the brief asks for max displacement < 0.02R per
    // one-point difference, but its own §2.1 radius formula moves a corner
    // 0.65R/20 = 0.0325R per point — the two numbers conflict, and the
    // formula wins (it is what draws the ten reference silhouettes). The
    // bound tested is the formula's own step plus rounding: no JUMPS is
    // the property; 0.02R is unachievable without changing §2.1. Flagged
    // in the PR.
    const step = (R * 0.65) / 20 + 1e-6;
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let n = 0; n < 200; n++) {
      const a = [20, 20, 20, 20, 20].map(() => Math.floor(rand() * 40));
      const from = Math.floor(rand() * 5);
      let to = Math.floor(rand() * 5);
      if (to === from) to = (to + 1) % 5;
      if (a[from] === 0) a[from] = 1;
      const b = [...a];
      b[from] -= 1;
      b[to] += 1;
      const va = blotCorners(a);
      const vb = blotCorners(b);
      for (let i = 0; i < 5; i++) {
        const d = Math.hypot(va[i].x - vb[i].x, va[i].y - vb[i].y);
        expect(d).toBeLessThanOrEqual(step);
      }
    }
  });

  it('puff is fattest at even split, tauter for spikes, always in [0.6, 1.2]', () => {
    expect(puffOf([20, 20, 20, 20, 20])).toBeCloseTo(1.15, 6);
    const needle = puffOf([90, 3, 3, 2, 2]);
    expect(needle).toBeLessThan(0.7);
    for (const ref of SHAPE_REFERENCES) {
      const p = puffOf(ref.allocation);
      expect(p).toBeGreaterThanOrEqual(0.6);
      expect(p).toBeLessThanOrEqual(1.2);
    }
  });

  it('fillets soften with the stat: a 0 is a tight pinch, a 100 the softest tip', () => {
    expect(filletOf(0)).toBe(26);
    expect(filletOf(100)).toBe(56);
    expect(filletOf(50)).toBe(41);
  });
});

describe('boundary helpers', () => {
  const square = [
    { x: 10, y: 10 },
    { x: 90, y: 10 },
    { x: 90, y: 90 },
    { x: 10, y: 90 },
  ];
  it('finds left/right crossings and the lowest edge', () => {
    expect(boundaryAtY(square, 50)).toEqual({ left: 10, right: 90 });
    expect(bottomAtX(square, 50)).toBe(90);
  });
  it('returns null when the line misses the polygon instead of inventing anchors', () => {
    expect(boundaryAtY(square, 200)).toBeNull();
    expect(bottomAtX(square, 200)).toBeNull();
  });
});

describe('the scene', () => {
  it('is deterministic: same allocation → byte-identical path strings', () => {
    for (const ref of SHAPE_REFERENCES) {
      const a = blotScene(ref.allocation);
      const b = blotScene(ref.allocation);
      expect(a.bodyPath).toBe(b.bodyPath);
      expect(a.seamPath).toBe(b.seamPath);
      expect(a.bodyPath.startsWith('M ')).toBe(true);
      expect(a.bodyPath.endsWith(' Z')).toBe(true);
      expect(a.bodyPath).toContain(' C ');
      expect(a.bodyPath).toContain(' Q ');
    }
  });

  it('keeps the visor at full width on ordinary bodies and narrows it only when the outline pinches', () => {
    const even = blotScene([20, 20, 20, 20, 20]);
    expect(even.visor.width).toBe(316);
    const needle = blotScene([90, 3, 3, 2, 2]);
    expect(needle.visor.width).toBeLessThan(316);
    expect(needle.visor.width).toBeGreaterThanOrEqual(120);
  });

  it('grows the heart with the Heart stat and only the Heart stat', () => {
    expect(blotScene([60, 10, 0, 10, 20]).heart.r).toBeCloseTo(52, 6);
    expect(blotScene([10, 10, 60, 10, 10]).heart.r).toBeCloseTo(52 + 36, 6);
    expect(blotScene([10, 10, 100, 10, 10]).heart.r).toBeCloseTo(112, 6);
  });

  it('zooms to fit: 1 for ordinary bodies, recedes continuously for extremes', () => {
    expect(blotScene([20, 20, 20, 20, 20]).fit).toBe(1);
    const spike = blotScene([60, 10, 10, 10, 10]).fit;
    expect(spike).toBeLessThan(1);
    expect(spike).toBeGreaterThan(0.4);
    const needle = blotScene([90, 3, 3, 2, 2]).fit;
    expect(needle).toBeLessThan(spike);
    expect(needle).toBeGreaterThan(0.3);
    // Continuity: one point of transfer moves fit only a little.
    const a = blotScene([59, 11, 10, 10, 10]).fit;
    expect(Math.abs(a - spike)).toBeLessThan(0.03);
  });

  it('keeps every reference standing ON the floor: shadow and feet below the whole outline', () => {
    // Checked against the DRAWN outline, not the virtual sharp corners —
    // the fillet trims each vertex, so the rendered body ends short of it
    // (a Big-Heart's virtual corner is ~40u past its drawn tip).
    for (const ref of SHAPE_REFERENCES) {
      const s = blotScene(ref.allocation);
      const outline = sampleOutline(
        outlineSegments(s.corners, s.puff, ref.allocation.map(filletOf))
      );
      const lowest = Math.max(...outline.map((p) => p.y));
      expect(s.shadow.cy).toBeGreaterThan(lowest);
      expect(s.legs.bottom).toBeGreaterThanOrEqual(lowest - 1e-6);
    }
  });
});
