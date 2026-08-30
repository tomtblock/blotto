/*
 * Radar-creature geometry — the allocation IS the character's body.
 *
 * Pure `Allocation → CreatureSpec`: no DOM, no React, no randomness, no
 * clock (the reveal-geometry/fragment-geometry posture, pinned by
 * creature-geometry.test.ts). The five radar vertices (the SAME mapping the
 * pentagon uses — src/battle/geometry.ts `pointFor`) are smoothed into a
 * closed blob, and each stat grows one deterministic feature whose size is
 * the stat's value:
 *
 *   Strength   → body mass is its vertex + horn length at the crown
 *   Speed      → swept fin spikes at the speed vertex
 *   Heart      → eye size + the soft core glow radius
 *   Wit        → antenna length at the wit vertex
 *   Durability → rim (shell) stroke thickness
 *
 * The point is legibility of the MECHANIC: two creatures on the battle
 * stage are literally two allocations compared, and after the reveal a
 * player can read an opponent's build off its silhouette. The numbers in
 * this file are fixed geometry (shape provenance), not feel knobs — the
 * fragment-geometry precedent; animation timings live in
 * src/arena/playback/constants.ts, never here.
 */

import type { Allocation } from '@/battle/allocation';
import { pointFor, type Point } from '@/battle/geometry';

/** The creature's own viewBox. All spec coordinates live in it. */
export const CREATURE_VIEWBOX = 200;
const CX = 100;
const CY = 102;
/** Outer radius a 100-stat vertex reaches — leaves feature headroom. */
const BODY_R = 58;

export interface CreatureSpike {
  /** SVG polygon points, absolute viewBox coords. */
  points: string;
}

export interface CreatureAntenna {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  tipR: number;
}

export interface CreatureEye {
  cx: number;
  cy: number;
  r: number;
}

export interface CreatureSpec {
  /** The smoothed allocation blob — the body. */
  bodyPath: string;
  /** Durability: shell thickness. */
  rimWidth: number;
  /** Strength: crown horns. */
  horns: readonly CreatureSpike[];
  /** Speed: swept fins. */
  fins: readonly CreatureSpike[];
  /** Heart: the eyes… */
  eyes: readonly CreatureEye[];
  /** …and the soft core glow. */
  glow: CreatureEye;
  /** Wit: antennae. */
  antennae: readonly CreatureAntenna[];
}

const f = (n: number) => Number(n.toFixed(2));
const fs = (n: number) => n.toFixed(2);

/** Vertex of stat `i` in viewBox coords (the radar's own mapping). */
function vertex(value: number, i: number): Point {
  const p = pointFor(value, i, BODY_R);
  return { x: CX + p.x, y: CY + p.y };
}

/** Catmull-Rom → cubic beziers, closed: the blob through the 5 vertices. */
function smoothClosedPath(pts: readonly Point[]): string {
  const n = pts.length;
  let d = `M ${fs(pts[0].x)} ${fs(pts[0].y)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${fs(c1x)} ${fs(c1y)}, ${fs(c2x)} ${fs(c2y)}, ${fs(p2.x)} ${fs(p2.y)}`;
  }
  return `${d} Z`;
}

/** An outward triangle spike: anchored at `a`, along `angleDeg`, sized. */
function spike(a: Point, angleDeg: number, length: number, width: number): CreatureSpike {
  const rad = (angleDeg * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const tipX = a.x + ux * length;
  const tipY = a.y + uy * length;
  const b1x = a.x - uy * (width / 2);
  const b1y = a.y + ux * (width / 2);
  const b2x = a.x + uy * (width / 2);
  const b2y = a.y - ux * (width / 2);
  return { points: `${fs(tipX)},${fs(tipY)} ${fs(b1x)},${fs(b1y)} ${fs(b2x)},${fs(b2y)}` };
}

/** Axis angle of stat `i` in degrees (the radar's fixed axes). */
const axisDeg = (i: number) => -90 + i * 72;

export function creatureSpec(allocation: Allocation): CreatureSpec {
  const [strength, speed, heart, wit, durability] = allocation;
  const verts = allocation.map((v, i) => vertex(v, i));

  const hornAnchor = verts[0];
  const hornLength = 7 + strength * 0.24;
  const hornWidth = 4 + strength * 0.05;

  const finAnchor = verts[1];
  const finBase = 5 + speed * 0.2;
  const finDir = axisDeg(1);

  const eyeR = 2.5 + heart * 0.05;
  const eyeGapX = 11;
  const eyeY = CY - 16;

  const witAnchor = verts[3];
  const antennaLength = 7 + wit * 0.26;
  const antennaDir = axisDeg(3);

  const antenna = (angleDeg: number): CreatureAntenna => {
    const rad = (angleDeg * Math.PI) / 180;
    return {
      x1: f(witAnchor.x),
      y1: f(witAnchor.y),
      x2: f(witAnchor.x + Math.cos(rad) * antennaLength),
      y2: f(witAnchor.y + Math.sin(rad) * antennaLength),
      tipR: f(1.8 + wit * 0.02),
    };
  };

  return {
    bodyPath: smoothClosedPath(verts),
    rimWidth: f(1.5 + durability * 0.06),
    horns: [
      spike(hornAnchor, axisDeg(0) - 16, hornLength, hornWidth),
      spike(hornAnchor, axisDeg(0) + 16, hornLength, hornWidth),
    ],
    fins: [
      spike(finAnchor, finDir, finBase, 4 + speed * 0.04),
      spike(finAnchor, finDir - 16, finBase * 0.7, 3 + speed * 0.03),
      spike(finAnchor, finDir + 16, finBase * 0.7, 3 + speed * 0.03),
    ],
    eyes: [
      { cx: f(CX - eyeGapX), cy: f(eyeY), r: f(eyeR) },
      { cx: f(CX + eyeGapX), cy: f(eyeY), r: f(eyeR) },
    ],
    glow: { cx: CX, cy: CY, r: f(9 + heart * 0.32) },
    antennae: [antenna(antennaDir - 10), antenna(antennaDir + 10)],
  };
}
