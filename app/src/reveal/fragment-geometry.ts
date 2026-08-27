/*
 * Shell-fragment geometry — FIXED, DETERMINISTIC (10.C Step 4, Beat 5).
 *
 * Same NG-007 posture as reveal-geometry.ts: every open bursts the SAME way,
 * for everyone, every time — no randomness anywhere in this module
 * (fragment-geometry.test.ts scans the source), so even cosmetic burst
 * variance can never invite outcome-reading. The "jitter" below is a fixed
 * integer hash of the fragment index: irregular to the eye, identical on
 * every run.
 *
 * Geometry provenance: the PR #118 spike's proven burst (golden-angle
 * spread, deterministic per-index hash), re-seated against the shared
 * pass's 200×250 viewBox (components/pass/pass-shell.tsx EGG_PATH; the spike
 * pass was 200×260 — burst origin moves to this pass's visual centre,
 * (100, 137), the 50%/55% transform origin the stage already uses).
 *
 * Like the reveal-step table, the numbers HERE are geometry, not feel knobs:
 * shapes, spread vectors, spins. The burst's *timing* magnitudes (flight
 * duration, scale decay, flash envelope) are Q-026 constants in
 * lib/reveal/constants.ts.
 */

export interface ShellFragment {
  /** Polygon points — a small shard in local coords around the burst origin. */
  points: string;
  /** Rest offset from the burst origin (pre-flight position on the shell), px. */
  x0: number;
  y0: number;
  /** Flight vector, px (slight upward bias — the shell pops up and out). */
  dx: number;
  dy: number;
  /** Total rotation over the flight, deg. */
  spinDeg: number;
  /** Rest scale of the shard. */
  scale: number;
}

export const FRAGMENT_COUNT = 16;

/** Fixed integer hash → [0,1). Deterministic per (index, salt); the only
 * "variation" source in the burst, and it is a pure function. */
function jitter(i: number, salt: number): number {
  return ((((i + 1) * 2654435761 + salt * 40503) >>> 0) % 1000) / 1000;
}

/** Build the fragment table. Exported (pure) so the test can pin
 * determinism by rebuilding and comparing. */
export function buildShellFragments(): ShellFragment[] {
  return Array.from({ length: FRAGMENT_COUNT }, (_, i) => {
    const angle = ((i * 137.5 + jitter(i, 1) * 24) * Math.PI) / 180;
    const dist = 92 + jitter(i, 2) * 58;
    const size = 7 + jitter(i, 3) * 9;
    return {
      points: `0,${-size} ${size * 0.9},${size * 0.6} ${-size * 0.8},${size * 0.5}`,
      x0: Math.cos(angle) * 26,
      y0: Math.sin(angle) * 34,
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist - 30,
      spinDeg: 180 + jitter(i, 4) * 360,
      scale: 0.8 + jitter(i, 5) * 0.5,
    };
  });
}

/** THE burst — one fixed table, shared by every open (NG-007). */
export const SHELL_FRAGMENTS: readonly ShellFragment[] = buildShellFragments();
