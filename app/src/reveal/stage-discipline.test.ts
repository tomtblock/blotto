/*
 * Choreography-discipline source scans — carried from the predecessor repository.
 *
 * A SOURCE scan (readFileSync + structural regex over the component source)
 * rather than a render test, because the vitest glob is .ts-only and because
 * these rules are about what the source may contain, not what it draws:
 *
 *  - NO numeric literal other than 0 and 1 inside any animation prop. Every
 *    magnitude is a named constant in reveal/constants.ts, so a device-tuning
 *    pass edits ONE file instead of hunting through JSX.
 *  - No randomness and no clock anywhere in stage source. An animation that
 *    reads Math.random or Date.now is not reproducible, and a reveal that is not
 *    reproducible cannot be audited.
 *  - The stage renders the SHARED pass component, never a second pass
 *    implementation. Two pass drawings drift.
 *  - CLASS COLOUR HAS ONE DOOR: no stage source writes a class colour token
 *    literal. The stage imports classColorToken and feeds it the class the
 *    machine's visual projection hands it — and that projection carries no class
 *    before the tell, at the type level. So revealing a class colour early is
 *    unwritable in stage source rather than merely discouraged.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REVEAL_STAGE_PATH = path.join(__dirname, "stages/reveal-stage.tsx");
const REVEAL_STAGE = readFileSync(REVEAL_STAGE_PATH, "utf8");

/*
 * One stage in Phase 0. The predecessor also scanned a card stage; neither it nor
 * the card component it staged was carried — both rendered the old product's
 * stat/trait/power-level metadata model, which this product does not have (a pass
 * carries a cosmetic class and nothing else; the five stats belong to a battle,
 * not to a pass). See EXTRACTION-REPORT.md.
 *
 * Phase 3 adds its own stages HERE, in this list, so they inherit these scans by
 * construction rather than by remembering.
 */
const STAGES: { name: string; source: string }[] = [
  { name: "reveal-stage", source: REVEAL_STAGE },
];

const ANIMATION_PROPS = [
  "initial",
  "animate",
  "exit",
  "transition",
  "whileTap",
  "whileHover",
  "whileInView",
];

/** Extract every `<prop>={…}` block with balanced-brace scanning. */
function animationPropBlocks(source: string): { prop: string; body: string }[] {
  const blocks: { prop: string; body: string }[] = [];
  for (const prop of ANIMATION_PROPS) {
    const marker = `${prop}={`;
    let from = 0;
    for (;;) {
      const at = source.indexOf(marker, from);
      if (at === -1) break;
      let depth = 0;
      let end = at + marker.length - 1;
      for (; end < source.length; end++) {
        const ch = source[end];
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      blocks.push({ prop, body: source.slice(at + marker.length - 1, end + 1) });
      from = end;
    }
  }
  return blocks;
}

describe("reveal-stage choreography discipline", () => {
  it("found animation props to scan (the scan is not blind)", () => {
    // Without this, every scan below would vacuously pass on an empty match set.
    expect(animationPropBlocks(REVEAL_STAGE).length).toBeGreaterThan(5);
  });

  it("no numeric literal except 0 and 1 in any animation prop", () => {
    for (const { name, source } of STAGES) {
      for (const { prop, body } of animationPropBlocks(source)) {
        // Strip string literals ("easeInOut" etc.) before scanning.
        const stripped = body.replace(/"[^"]*"|'[^']*'/g, "");
        const numbers = stripped.match(/(?<![\w.])\d+(?:\.\d+)?/g) ?? [];
        const offenders = numbers.filter((n) => n !== "0" && n !== "1");
        expect(
          offenders,
          `${name}: ${prop}=${body.slice(0, 120)}… carries inline magnitudes: ${offenders.join(", ")}`,
        ).toEqual([]);
      }
    }
  });

  it("no randomness or clock in stage source (NG-007)", () => {
    for (const { name, source } of STAGES) {
      expect(
        /Math\.random|Date\.now|new Date\(/.test(source),
        name,
      ).toBe(false);
    }
  });

  it("the reveal stage renders the SHARED pass — no second pass implementation", () => {
    expect(REVEAL_STAGE).toContain('from "@/reveal/components/pass-shell"');
    // A locally-defined pass path would be the fork we forbid.
    expect(/PASS_PATH\s*=/.test(REVEAL_STAGE)).toBe(false);
    expect(/M100 8 C/.test(REVEAL_STAGE)).toBe(false);
  });

  it("no class/gold/price colour token literal in ANY stage source", () => {
    for (const { name, source } of STAGES) {
      expect(
        /--color-class|--color-rarity|bg-class|text-class|rarity-gold|price-up|price-down/.test(
          source,
        ),
        name,
      ).toBe(false);
    }
  });

  it("class colour enters the reveal stage ONLY through the mapping module", () => {
    expect(REVEAL_STAGE).toContain('from "@/reveal/class-colour"');
    expect(REVEAL_STAGE).toContain("classColorToken(");
  });
});
