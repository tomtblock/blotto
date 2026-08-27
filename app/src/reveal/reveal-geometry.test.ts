/*
 * Reveal-geometry guards (10.C Step 3): the reveal pattern is FIXED per tap
 * index — deterministic, table-driven, zero randomness (NG-007: no
 * per-open visual variation exists before the tell).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TAP_COUNT } from "./constants";
import { REVEAL_STEPS, revealStep } from "./reveal-geometry";

const SOURCE = readFileSync(
  path.join(__dirname, "reveal-geometry.ts"),
  "utf8",
);

/** First and last coordinate pair of an M/L path string. */
function endpoints(d: string): { start: string; end: string } {
  const pairs = d.match(/-?\d+(?:\.\d+)? -?\d+(?:\.\d+)?/g) ?? [];
  return { start: pairs[0] ?? "", end: pairs[pairs.length - 1] ?? "" };
}

describe("reveal geometry — deterministic per tap index", () => {
  it("tap N yields identical geometry across instantiations", () => {
    for (let i = 0; i < REVEAL_STEPS.length; i++) {
      const a = revealStep(i);
      const b = revealStep(i);
      expect(b).toEqual(a);
      expect(a).toEqual(REVEAL_STEPS[i]);
    }
  });

  it("covers TAP_COUNT and fails loudly one past the table", () => {
    expect(TAP_COUNT).toBeLessThanOrEqual(REVEAL_STEPS.length);
    for (let i = 0; i < TAP_COUNT; i++) {
      expect(() => revealStep(i)).not.toThrow();
    }
    expect(() => revealStep(REVEAL_STEPS.length)).toThrow(RangeError);
  });

  it("segments are continuous — each starts where the previous ended", () => {
    for (let i = 1; i < REVEAL_STEPS.length; i++) {
      expect(endpoints(REVEAL_STEPS[i].path).start).toBe(
        endpoints(REVEAL_STEPS[i - 1].path).end,
      );
    }
  });

  it("jolts alternate direction so consecutive taps read distinct", () => {
    for (let i = 1; i < REVEAL_STEPS.length; i++) {
      expect(
        Math.sign(REVEAL_STEPS[i].jolt.x) !==
          Math.sign(REVEAL_STEPS[i - 1].jolt.x),
      ).toBe(true);
    }
  });

  it("no randomness or clock exists in the module source", () => {
    expect(/Math\.random|Date\.now|crypto\./.test(SOURCE)).toBe(false);
  });
});
