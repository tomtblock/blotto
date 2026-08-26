/*
 * Fragment-geometry guard (10.C Step 4): the burst is FIXED — deterministic
 * per NG-007, no randomness or clock in the source (same scan as
 * reveal-geometry.test.ts), and every vector is finite.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FRAGMENT_COUNT,
  SHELL_FRAGMENTS,
  buildShellFragments,
} from "./fragment-geometry";

const SOURCE = readFileSync(
  path.join(__dirname, "fragment-geometry.ts"),
  "utf8",
);

describe("shell-fragment geometry (NG-007)", () => {
  it("no randomness or clock in the source", () => {
    expect(/Math\.random|Date\.now|new Date\(/.test(SOURCE)).toBe(false);
  });

  it("deterministic: rebuilding yields the identical table", () => {
    expect(buildShellFragments()).toEqual(SHELL_FRAGMENTS);
    expect(buildShellFragments()).toEqual(buildShellFragments());
  });

  it("the table is full and every vector finite", () => {
    expect(SHELL_FRAGMENTS).toHaveLength(FRAGMENT_COUNT);
    for (const f of SHELL_FRAGMENTS) {
      for (const v of [f.x0, f.y0, f.dx, f.dy, f.spinDeg, f.scale]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(f.points.length).toBeGreaterThan(0);
    }
  });

  it("the burst spreads — fragments fly outward, not into a clump", () => {
    const distances = SHELL_FRAGMENTS.map((f) => Math.hypot(f.dx, f.dy));
    expect(Math.min(...distances)).toBeGreaterThan(30);
    // Directional coverage: shards land in all four quadrants.
    const quadrants = new Set(
      SHELL_FRAGMENTS.map((f) => `${Math.sign(f.dx)}:${Math.sign(f.dy)}`),
    );
    expect(quadrants.size).toBeGreaterThanOrEqual(4);
  });
});
