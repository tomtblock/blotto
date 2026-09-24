/*
 * ARENA LAYOUT — ported from the founder's mockup (timdontplay/blotto-game,
 * src/model/map.ts, commit 9d3821f) and kept numerically identical so the
 * painted map in /board-art/map.webp lines up with the hit polygons.
 *
 * One world, 2048 × 2048 units, covered by the painted map and surrounded
 * by endless forest. The origin is where the seven dirt roads meet at the
 * foot of the keep. The seven painted roads divide the grass into seven
 * FIELDS, numbered clockwise from the field just right of 12 o'clock; a
 * battle is fought on a field. Each field has five rally points, one per
 * stat; troops of that stat gather around theirs in a deterministic
 * sunflower blob (`troopSlot`). Deterministic: every player sees the same
 * layout.
 */

import { STATS } from '@/battle/allocation';
import { FIELDS } from '@/battle/board/mode';

export interface Point {
  x: number;
  y: number;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Field {
  index: number;
  name: string;
  /** Bounding road angles, radians, clockwise from +x; a1 > a0. */
  a0: number;
  a1: number;
  mid: number;
  /** Annular wedge between the two roads, keep edge to arena rim. */
  polygon: Point[];
  /** Where troops of each stat gather, in stat order. */
  rallyPoints: Point[];
  /** Where the field's plaque sits (on the rim, mid angle). */
  plaque: Point;
  /** Framing box for "fit field". */
  bounds: BBox;
}

export interface MapLayout {
  fields: Field[];
  roadAngles: number[];
  keep: { x: number; y: number; r: number };
  image: { x: number; y: number; size: number };
  world: BBox;
  bounds: BBox;
  limit: BBox;
}

export const GEOMETRY = {
  worldHalf: 1024,
  imageConvergence: { x: 488, y: 460 },
  /** Painted road centre angles in degrees, clockwise from +x, Road 1 first (12 o'clock). */
  roadAngles: [272.5, 328, 11.5, 50, 122, 171.5, 218],
  keepRadius: 240,
  fieldInner: 265,
  fieldOuter: 880,
  arenaRadius: 950,
  roadHalfWidth: 34,
  rally: [
    { r: 420, f: 0.5 },
    { r: 560, f: 0.22 },
    { r: 560, f: 0.78 },
    { r: 715, f: 0.3 },
    { r: 715, f: 0.7 },
  ],
  plaqueRadius: 905,
  spriteSize: 64,
  groundSquash: 0.72,
} as const;

/** World units between neighbouring troops in a crowd. */
export const CROWD_SPACING = 30;

const TAU = Math.PI * 2;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

function bboxOf(points: Point[], pad: number): BBox {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad, maxX: Math.max(...xs) + pad, maxY: Math.max(...ys) + pad };
}

function polar(r: number, angle: number): Point {
  return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
}

function roadMargin(r: number): number {
  return Math.asin(Math.min(0.9, (GEOMETRY.roadHalfWidth + 10) / r));
}

export function buildMap(): MapLayout {
  const G = GEOMETRY;
  const n = FIELDS;
  const roadAngles = Array.from({ length: n }, (_, k) => (((G.roadAngles[k] ?? -90 + (360 / n) * k) % 360) * Math.PI) / 180);
  const fields: Field[] = [];
  for (let k = 0; k < n; k++) {
    const a0 = roadAngles[k] as number;
    let a1 = roadAngles[(k + 1) % n] as number;
    while (a1 <= a0) a1 += TAU;
    const mid = (a0 + a1) / 2;
    const polygon: Point[] = [];
    const steps = 8;
    const mo = roadMargin(G.fieldOuter);
    for (let i = 0; i <= steps; i++) polygon.push(polar(G.fieldOuter, a0 + mo + ((a1 - mo - (a0 + mo)) * i) / steps));
    const mi = roadMargin(G.fieldInner);
    for (let i = 4; i >= 0; i--) polygon.push(polar(G.fieldInner, a0 + mi + ((a1 - mi - (a0 + mi)) * i) / 4));
    const rallyPoints = G.rally.map(({ r, f }) => {
      const m = roadMargin(r);
      return polar(r, a0 + m + (a1 - a0 - 2 * m) * f);
    });
    const plaque = polar(G.plaqueRadius, mid);
    fields.push({ index: k, name: `Field ${k + 1}`, a0, a1, mid, polygon, rallyPoints, plaque, bounds: bboxOf([...polygon, plaque], 30) });
  }
  const H = G.worldHalf;
  const px = (2 * H) / 1024;
  const image = { x: -G.imageConvergence.x * px, y: -G.imageConvergence.y * px, size: 2 * H };
  const R = G.arenaRadius;
  return {
    fields,
    roadAngles,
    keep: { x: 0, y: 0, r: G.keepRadius },
    image,
    world: { minX: image.x, minY: image.y, maxX: image.x + image.size, maxY: image.y + image.size },
    bounds: { minX: -R, minY: -R - 60, maxX: R, maxY: R + 40 },
    limit: { minX: -R * 1.1, minY: -R * 1.1, maxX: R * 1.1, maxY: R * 1.1 },
  };
}

/** Which field a world point is in, or null on the keep or beyond the rim. */
export function fieldAt(layout: MapLayout, p: Point): number | null {
  const r = Math.hypot(p.x, p.y);
  if (r < GEOMETRY.keepRadius || r > GEOMETRY.arenaRadius) return null;
  const a = Math.atan2(p.y, p.x);
  for (const f of layout.fields) {
    const rel = (((a - f.a0) % TAU) + TAU) % TAU;
    if (rel < f.a1 - f.a0) return f.index;
  }
  return null;
}

/** Troop `i` of a blob centred on `c`: sunflower spiral, flattened to the ground. */
export function blobSlot(c: Point, i: number): Point {
  const r = CROWD_SPACING * 0.564 * Math.sqrt(i);
  const a = i * GOLDEN;
  return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) * GEOMETRY.groundSquash };
}

/** Where troop `i` of `stat` stands on a field. Depends only on (field, stat, i). */
export function troopSlot(field: Field, stat: number, i: number): Point {
  return blobSlot(field.rallyPoints[stat] ?? (field.rallyPoints[0] as Point), i);
}

/** Radius of a blob of `count` troops (before ground squash). */
export function blobRadius(count: number): number {
  return count <= 1 ? 0 : CROWD_SPACING * 0.564 * Math.sqrt(count - 1);
}

export { FIELDS, STATS };
