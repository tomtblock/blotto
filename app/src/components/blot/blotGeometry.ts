/*
 * The Blot's body geometry — pure, DOM-free, pinned by blotGeometry tests.
 * Implements the architect brief "BlotMorph + StatDials" §2.
 *
 * THE BLOT IS THE ALLOCATION MADE FLESH. Five corners map to the five stats
 * in the fixed stat order — top = Strength, then clockwise Speed, Heart,
 * Wit, Durability — the same convention as the on-chain array
 * (`STAT_NAMES`, src/battle/allocation.ts). It was inherited from the
 * pentagon radar this shape system replaced; that module's geometry had no
 * consumer left and was removed with the rest of the radar (audit
 * 2026-09-11, A-27).
 *
 * ONE SHAPE, ALWAYS (brief §0). The outline is a single closed path of
 * cubic Béziers with rounded corners, and every parameter — corner radius,
 * edge bulge, fillet trim, puff — is a continuous function of the
 * allocation. Interpolating the allocation therefore interpolates the
 * shape with no cut, swap, pop or sprite change. Nothing here (or
 * anywhere) may substitute a pre-rendered image for the live outline.
 *
 * UNITS: everything works in the brief's normalised 1000×1000 space
 * (centre (500, 480), R = 330). Renderers scale via the SVG viewBox, so
 * the numbers in this file are the numbers in the brief.
 *
 * THE SHAPE SYSTEM IS A READOUT, NEVER AN INPUT. The ten named references
 * below exist for display-quality review, pool-state objects and the
 * gallery. PID §4.3 (quantified) forbids offering them as targets: presets
 * or shape-buttons collapse the 4,598,126-option space toward 126 and the
 * 7% draw rate toward 86%. Nothing in this module may be wired to a
 * control that SETS an allocation from a shape, and no shape name is
 * shown during a live battle.
 */

export interface Point {
  x: number;
  y: number;
}

/** The brief's normalised space: geometry is computed at 1000×1000. */
export const UNIT = 1000;
export const CENTRE_X = 500;
export const CENTRE_Y = 480;
export const BASE_RADIUS = 330;
/** radius_i = R·(MIN_REACH + alloc/20 · SPAN), clamped to [FLOOR, CEIL]·R. */
export const MIN_REACH = 0.35;
export const SPAN_PER_20 = 0.65;
export const REACH_FLOOR = 0.3;
export const REACH_CEIL = 3.6;
/* Feet stand on a common ground line (brief §2.3). PHASE-4-REVIEW: the
 * brief fixes groundY absolutely, but a Big-Heart's swollen corner reaches
 * y≈1094 — through a fixed floor. The floor yields only when the body
 * would pierce it; every ordinary shape stands on GROUND_Y exactly. */
export const GROUND_Y = 940;

/** Corner distance from centre for one stat value, in units. */
export function cornerDistance(value: number): number {
  const r = BASE_RADIUS * (MIN_REACH + (value / 20) * SPAN_PER_20);
  return Math.min(Math.max(r, REACH_FLOOR * BASE_RADIUS), REACH_CEIL * BASE_RADIUS);
}

const cornerAngle = (i: number) => ((-90 + i * 72) * Math.PI) / 180;

/** The five corner points for a (possibly fractional, mid-spring) allocation. */
export function blotCorners(allocation: readonly number[]): Point[] {
  return allocation.map((value, i) => {
    const a = cornerAngle(i);
    const r = cornerDistance(value);
    return { x: CENTRE_X + Math.cos(a) * r, y: CENTRE_Y + Math.sin(a) * r };
  });
}

/**
 * Inflation (brief §2.2): even split is fattest, extreme spikes are tauter —
 * vinyl under pressure. puff = 1.15 − 0.55·(stddev/40), clamped 0.6..1.2.
 */
export function puffOf(allocation: readonly number[]): number {
  const mean = allocation.reduce((a, b) => a + b, 0) / allocation.length;
  const variance =
    allocation.reduce((a, b) => a + (b - mean) * (b - mean), 0) / allocation.length;
  const puff = 1.15 - 0.55 * (Math.sqrt(variance) / 40);
  return Math.min(1.2, Math.max(0.6, puff));
}

/** Corner fillet radius: bigger stats have softer, more inflated tips. */
export function filletOf(value: number): number {
  return 26 + 30 * (Math.max(0, Math.min(100, value)) / 100);
}

export interface OutlineSegment {
  /** Cubic edge from the previous corner's exit point to `entry`. */
  c1: Point;
  c2: Point;
  entry: Point;
  /** Quadratic corner join: control = the sharp vertex, ending at `exit`. */
  vertex: Point;
  exit: Point;
}

/**
 * The closed outline as five (edge-cubic + corner-quadratic) segments.
 * Edges bow OUTWARD by 0.09·|edge|·puff; each sharp vertex is replaced by
 * a quadratic join between trim points at the fillet's tangent distance
 * (fillet/tan(θ/2), capped at 35% of the adjacent edge). Every quantity is
 * continuous in the corners, so a one-point allocation change moves the
 * outline by at most one radius step — no jumps, ever.
 */
export function outlineSegments(
  corners: readonly Point[],
  puff: number,
  fillets: readonly number[]
): OutlineSegment[] {
  const n = corners.length;

  // Ideal trim at each corner from ITS fillet and interior angle.
  const ideal = corners.map((c, i) => {
    const prev = corners[(i + n - 1) % n];
    const next = corners[(i + 1) % n];
    const a = { x: prev.x - c.x, y: prev.y - c.y };
    const b = { x: next.x - c.x, y: next.y - c.y };
    const la = Math.hypot(a.x, a.y) || 1;
    const lb = Math.hypot(b.x, b.y) || 1;
    const cos = Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / (la * lb)));
    const tan = Math.tan(Math.acos(cos) / 2);
    return tan > 1e-6 ? fillets[i] / tan : Number.POSITIVE_INFINITY;
  });

  const segs: OutlineSegment[] = [];
  for (let i = 0; i < n; i++) {
    const from = corners[i];
    const to = corners[(i + 1) % n];
    const edge = { x: to.x - from.x, y: to.y - from.y };
    const len = Math.hypot(edge.x, edge.y) || 1;
    // Outward normal for our clockwise (screen) winding.
    const nrm = { x: edge.y / len, y: -edge.x / len };
    const bulge = 0.09 * len * puff;

    const c1 = {
      x: from.x + 0.36 * edge.x + nrm.x * bulge,
      y: from.y + 0.36 * edge.y + nrm.y * bulge,
    };
    const c2 = {
      x: to.x - 0.36 * edge.x + nrm.x * bulge,
      y: to.y - 0.36 * edge.y + nrm.y * bulge,
    };

    const tIn = Math.min(ideal[(i + 1) % n], 0.35 * len);
    const entry = { x: to.x - (edge.x / len) * tIn, y: to.y - (edge.y / len) * tIn };

    const next = corners[(i + 2) % n];
    const out = { x: next.x - to.x, y: next.y - to.y };
    const outLen = Math.hypot(out.x, out.y) || 1;
    const tOut = Math.min(ideal[(i + 1) % n], 0.35 * outLen);
    const exit = { x: to.x + (out.x / outLen) * tOut, y: to.y + (out.y / outLen) * tOut };

    segs.push({ c1, c2, entry, vertex: to, exit });
  }
  return segs;
}

const f = (v: number) => v.toFixed(2);

/** SVG path `d` for a segment list — fixed 2-decimal formatting, so the
 * same allocation always serialises to the identical string (the
 * deterministic-still requirement, brief §9.9). */
export function segmentsToPath(segs: readonly OutlineSegment[]): string {
  const start = segs[segs.length - 1].exit;
  let d = `M ${f(start.x)} ${f(start.y)}`;
  for (const s of segs) {
    d += ` C ${f(s.c1.x)} ${f(s.c1.y)} ${f(s.c2.x)} ${f(s.c2.y)} ${f(s.entry.x)} ${f(s.entry.y)}`;
    d += ` Q ${f(s.vertex.x)} ${f(s.vertex.y)} ${f(s.exit.x)} ${f(s.exit.y)}`;
  }
  return `${d} Z`;
}

/** Sample the outline into a polyline for boundary queries (anchors). */
export function sampleOutline(segs: readonly OutlineSegment[], perSegment = 12): Point[] {
  const pts: Point[] = [];
  let prev = segs[segs.length - 1].exit;
  for (const s of segs) {
    for (let k = 1; k <= perSegment; k++) {
      const t = k / perSegment;
      pts.push(cubicAt(prev, s.c1, s.c2, s.entry, t));
    }
    for (let k = 1; k <= Math.max(3, perSegment >> 1); k++) {
      const t = k / Math.max(3, perSegment >> 1);
      pts.push(quadAt(s.entry, s.vertex, s.exit, t));
    }
    prev = s.exit;
  }
  return pts;
}

function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

function quadAt(p0: Point, p1: Point, p2: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

/**
 * Where a polyline's boundary crosses the horizontal line `y` — arm anchors
 * ride the LIVE outline, so a Tank's arms sit wide and a Needle's sit
 * tight. Null when the line misses the body (extreme shapes); callers fall
 * back to the centre column.
 */
export function boundaryAtY(points: readonly Point[], y: number): { left: number; right: number } | null {
  const xs: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if ((a.y <= y && b.y >= y) || (b.y <= y && a.y >= y)) {
      if (a.y === b.y) xs.push(a.x, b.x);
      else xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
  }
  if (xs.length === 0) return null;
  return { left: Math.min(...xs), right: Math.max(...xs) };
}

/** The lowest boundary y at a vertical line `x` (leg anchors). */
export function bottomAtX(points: readonly Point[], x: number): number | null {
  const ys: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if ((a.x <= x && b.x >= x) || (b.x <= x && a.x >= x)) {
      if (a.x === b.x) ys.push(a.y, b.y);
      else ys.push(a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y));
    }
  }
  if (ys.length === 0) return null;
  return Math.max(...ys);
}

/** Everything a renderer needs to draw one Blot, in 1000-unit coordinates. */
export interface BlotScene {
  corners: Point[];
  puff: number;
  bodyPath: string;
  seamPath: string;
  visor: { cx: number; cy: number; width: number; height: number; rx: number };
  heart: { cx: number; cy: number; r: number };
  arms: {
    left: { x: number; y: number; angle: number };
    right: { x: number; y: number; angle: number };
    width: number;
    length: number;
    rx: number;
  };
  legs: {
    left: { x: number; top: number };
    right: { x: number; top: number };
    bottom: number;
    width: number;
    rx: number;
  };
  ground: number;
  shadow: { cx: number; cy: number; rx: number; ry: number };
  specular: { cx: number; cy: number; rx: number; ry: number };
  /**
   * Camera zoom that keeps the WHOLE scene inside the 1000-unit frame:
   * renderers scale everything about the centre by this factor. 1 for
   * every ordinary body; recedes continuously as a corner stretches
   * toward 3.6R (a Spike at 60 fits at ~0.6). PHASE-4-REVIEW: the brief
   * does not specify framing for shapes that outgrow the stage; zooming
   * beats cropping because the reference renders always show the full
   * body, and a continuous scale keeps the no-jumps guarantee.
   */
  fit: number;
}

/**
 * Assemble the full scene from a (possibly fractional, mid-spring)
 * allocation. Pure: same input → identical scene, identical path strings.
 */
export function blotScene(display: readonly number[], puffScale = 1): BlotScene {
  const corners = blotCorners(display);
  const puff = puffOf(display) * puffScale;
  const fillets = display.map(filletOf);
  const segs = outlineSegments(corners, puff, fillets);
  const bodyPath = segmentsToPath(segs);

  // Seam: the outline scaled 0.92 about the centre (brief §2.4).
  const seamCorners = corners.map((p) => ({
    x: CENTRE_X + (p.x - CENTRE_X) * 0.92,
    y: CENTRE_Y + (p.y - CENTRE_Y) * 0.92,
  }));
  const seamPath = segmentsToPath(
    outlineSegments(seamCorners, puff, fillets.map((v) => v * 0.92))
  );

  const samples = sampleOutline(segs);
  const topY = Math.min(...samples.map((p) => p.y));
  const lowY = Math.max(...samples.map((p) => p.y));
  const minX = Math.min(...samples.map((p) => p.x));
  const maxX = Math.max(...samples.map((p) => p.x));

  /* Visor: centred on C + (0, −0.42R), clamped to stay inside the outline
   * with a 40u margin (brief §2.3). Both clamps are continuous: the
   * vertical one against the outline's top, the width one against the
   * body's width at the visor line. */
  const visorH = 86;
  let visorCy = Math.max(CENTRE_Y - 0.42 * BASE_RADIUS, topY + 40 + visorH / 2);
  visorCy = Math.min(visorCy, CENTRE_Y); // never below the body centre
  const at = boundaryAtY(samples, visorCy);
  const avail = at ? at.right - at.left : 0;
  const visorW = Math.max(120, Math.min(316, avail - 80));
  const visor = { cx: CENTRE_X, cy: visorCy, width: visorW, height: visorH, rx: Math.min(43, visorW / 2) };

  /* Heart glow: the ONE feature that scales with a stat (Heart, index 2). */
  const hrt = Math.max(0, Math.min(100, display[2]));
  const heart = { cx: CENTRE_X, cy: CENTRE_Y + 0.12 * BASE_RADIUS, r: 52 + 60 * (hrt / 100) };

  /* Arms: anchored to the live outline at the body's waist line. */
  const armLine = boundaryAtY(samples, CENTRE_Y) ?? {
    left: CENTRE_X - 0.4 * BASE_RADIUS,
    right: CENTRE_X + 0.4 * BASE_RADIUS,
  };
  const arms = {
    left: { x: armLine.left + 12, y: CENTRE_Y - 10, angle: 20 },
    right: { x: armLine.right - 12, y: CENTRE_Y - 10, angle: -20 },
    width: 86,
    length: 190,
    rx: 43,
  };

  /* Legs: at C.x ± 0.28R, feet on the common ground line. The floor yields
   * only when the body would pierce it (see GROUND_Y note above). */
  const ground = Math.max(GROUND_Y, lowY + 20);
  const legXL = CENTRE_X - 0.28 * BASE_RADIUS;
  const legXR = CENTRE_X + 0.28 * BASE_RADIUS;
  const legs = {
    left: { x: legXL, top: (bottomAtX(samples, legXL) ?? CENTRE_Y + 0.5 * BASE_RADIUS) - 40 },
    right: { x: legXR, top: (bottomAtX(samples, legXR) ?? CENTRE_Y + 0.5 * BASE_RADIUS) - 40 },
    bottom: ground,
    width: 96,
    rx: 48,
  };

  /* Floor shadow under the feet; width follows the body's width. */
  const shadow = { cx: (minX + maxX) / 2, cy: ground + 12, rx: 0.45 * (maxX - minX), ry: 30 };

  /* Specular slides with the corners' centroid — it stays on the shoulder
   * of whichever corner is biggest. */
  const centroidX = corners.reduce((a, p) => a + p.x, 0) / corners.length;
  const centroidY = corners.reduce((a, p) => a + p.y, 0) / corners.length;
  const specular = {
    cx: centroidX - 0.28 * BASE_RADIUS,
    cy: centroidY - 0.3 * BASE_RADIUS,
    rx: 90,
    ry: 55,
  };

  const spanTop = Math.max(1, CENTRE_Y - topY);
  const spanLeft = Math.max(1, CENTRE_X - minX + 30); // arms reach past the outline
  const spanRight = Math.max(1, maxX - CENTRE_X + 30);
  const spanBottom = Math.max(1, shadow.cy + shadow.ry - CENTRE_Y);
  const fit = Math.min(
    1,
    460 / spanTop,
    470 / spanLeft,
    470 / spanRight,
    515 / spanBottom
  );

  return { corners, puff, bodyPath, seamPath, visor, heart, arms, legs, ground, shadow, specular, fit };
}

/* ————————————————————————————————————————————————————————————————————————
 * The ten reference bodies (brand guide page 03, exact allocations). A
 * READOUT VOCABULARY for review and display copy: the gallery's line-up,
 * pool-state objects, the acceptance sign-off against the Higgsfield
 * renders. Never presented as targets — see the module header. There is
 * deliberately NO nearest-shape lookup and NO sprite substitution: the
 * live outline is the only Blot (brief §10, "one shape").
 * ———————————————————————————————————————————————————————————————————————— */
export const SHAPE_REFERENCES = [
  { code: 'EV', name: 'Even', allocation: [20, 20, 20, 20, 20] },
  { code: 'SP', name: 'Spike', allocation: [60, 10, 10, 10, 10] },
  { code: 'DA', name: 'Dasher', allocation: [10, 60, 10, 10, 10] },
  { code: 'BH', name: 'Big-Heart', allocation: [10, 10, 60, 10, 10] },
  { code: 'BR', name: 'Brainy', allocation: [10, 10, 10, 60, 10] },
  { code: 'TK', name: 'Tank', allocation: [10, 10, 10, 10, 60] },
  { code: 'TP', name: 'Twin-Peaks', allocation: [40, 40, 7, 7, 6] },
  { code: 'AN', name: 'Anvil', allocation: [5, 5, 45, 45, 0] },
  { code: 'PK', name: 'Pancake', allocation: [0, 50, 0, 0, 50] },
  { code: 'NE', name: 'Needle', allocation: [90, 3, 3, 2, 2] },
] as const;

export type ShapeCode = (typeof SHAPE_REFERENCES)[number]['code'];
