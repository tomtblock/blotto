/*
 * Reveal geometry — FIXED, DETERMINISTIC, per tap index (10.C Step 3).
 *
 * NG-007 hard rule: no per-open visual variation exists before the tell —
 * every open shows the SAME reveal pattern at tap N, for everyone, every
 * time. There is deliberately no randomness anywhere in this module (and
 * reveal-geometry.test.ts scans the source to keep it that way): the reveal
 * is theatre over a fixed outcome, and even cosmetic variance would invite
 * "my reveals looked different" outcome-reading.
 *
 * Geometry provenance: the PR #118 spike's proven segments, re-seated
 * against the shared pass's 200×250 viewBox (components/pass/pass-shell.tsx
 * EGG_PATH — the spike pass was 200×260). Each segment continues where the
 * previous ended, so the accumulated reveal reads as one growing fracture.
 * Jolt impulses alternate direction so consecutive taps read distinct —
 * the TABLE is fixed; which impulse plays depends only on the tap index.
 */

export interface RevealStep {
  /** SVG path for this tap's reveal segment (200×250 pass coordinates). */
  path: string;
  /** Jolt impulse the pass plays on this tap. */
  jolt: { x: number; rotateDeg: number };
}

export const REVEAL_STEPS: readonly RevealStep[] = [
  {
    path: "M100 40 L91 62 L107 82 L95 102",
    jolt: { x: -7, rotateDeg: -2.5 },
  },
  {
    path: "M95 102 L111 120 L97 140 L113 158",
    jolt: { x: 8, rotateDeg: 3 },
  },
  {
    path: "M113 158 L99 176 L115 194 L103 212",
    jolt: { x: -9, rotateDeg: -3.5 },
  },
];

/**
 * The geometry for tap index `i` (0-based). Throws on an index the table
 * does not cover: if TAP_COUNT is ever tuned past the table, the build
 * must fail loudly here rather than improvise geometry (improvised =
 * potentially varying = NG-007 breach). A test pins TAP_COUNT ≤ table.
 */
export function revealStep(tapIndex: number): RevealStep {
  const step = REVEAL_STEPS[tapIndex];
  if (step === undefined) {
    throw new RangeError(
      `no reveal geometry for tap index ${tapIndex} — extend REVEAL_STEPS in lockstep with TAP_COUNT`,
    );
  }
  return step;
}
