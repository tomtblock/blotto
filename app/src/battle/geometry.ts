/*
 * Pentagon-radar geometry (PID §4.2) — the pure half of the radar, pinned by
 * geometry.test.ts (the carried reveal-geometry pattern: no DOM, no React).
 *
 * Five axes from the centre, stat i at angle -90° + i·72° (Strength at the
 * top, clockwise in fixed stat order). A value 0..100 maps linearly along
 * its axis between an inner dead-zone radius (a zero stat must still leave
 * a grabbable vertex) and the outer radius. Dragging projects the pointer
 * onto the axis and inverts the same mapping — no snapping, no detents
 * (PID §4.3: anything that offers a target clusters the population).
 */

export const AXES = 5;
/** Inner radius fraction a value of 0 renders at (the grab dead-zone). */
export const INNER_FRACTION = 0.08;

export interface Point {
  x: number;
  y: number;
}

/** Unit vector of stat axis `i`. */
export function axisUnit(i: number): Point {
  const angle = (-90 + i * 72) * (Math.PI / 180);
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/** The rendered vertex for `value` (0..100) on axis `i`, centre (0,0), outer radius `r`. */
export function pointFor(value: number, i: number, r: number): Point {
  const clamped = Math.max(0, Math.min(100, value));
  const dist = r * (INNER_FRACTION + (1 - INNER_FRACTION) * (clamped / 100));
  const u = axisUnit(i);
  return { x: u.x * dist, y: u.y * dist };
}

/**
 * Invert: a pointer at (x, y) relative to the centre → the axis-`i` value
 * 0..100. The SIGNED projection is used, clamped — dragging past the centre
 * onto the opposite side reads as 0, never as a negative or mirrored value.
 */
export function valueForPointer(x: number, y: number, i: number, r: number): number {
  const u = axisUnit(i);
  const projected = x * u.x + y * u.y;
  const fraction = (projected / r - INNER_FRACTION) / (1 - INNER_FRACTION);
  return Math.max(0, Math.min(100, fraction * 100));
}

/** SVG polygon points string for a whole allocation. */
export function polygonPoints(values: readonly number[], r: number, cx = 0, cy = 0): string {
  return values
    .map((v, i) => {
      const p = pointFor(v, i, r);
      return `${(cx + p.x).toFixed(2)},${(cy + p.y).toFixed(2)}`;
    })
    .join(' ');
}
