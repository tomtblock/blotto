/*
 * Tell colour-mapping guard (10.C Step 4): the class→token map is exhaustive
 * and the TOP class's token is UNREACHABLE for every lesser class. This
 * product has five classes, 0–4 (types.ts); the predecessor's D-03a /
 * reveal-spec §1 pinned "gold strictly = the rarest of six tiers", carried
 * across by POSITION as class 4, Titan, whose token tokens.css pins to the
 * gold value (--color-class-4 = --color-rarity-gold = #ffd24a).
 *
 * Scope note: these assertions are at the token-NAME level — vitest cannot
 * resolve CSS. The rendered-result half (the resolved gold VALUE appearing
 * for class 4 and no other classIndex) is the visual guard's job
 * (scripts/verify-reveal-takeover.mjs, both engines).
 */

import { describe, expect, it } from "vitest";
import { ALL_CLASSES, type RevealClass } from "./types";
import { CLASS_COLOR_TOKENS, classColorToken } from "./class-colour";

describe("tell class→colour mapping", () => {
  it("maps every class 0–4 to exactly its own ladder token (exhaustive)", () => {
    for (const classIndex of ALL_CLASSES) {
      expect(classColorToken(classIndex)).toBe(`var(--color-class-${classIndex})`);
    }
  });

  it("the map is closed — five entries, no extras", () => {
    expect(Object.keys(CLASS_COLOR_TOKENS)).toHaveLength(5);
  });

  it("the top class's token is unreachable from any other class", () => {
    // The predecessor's version of this test pinned "gold strictly means the
    // rarest tier". The same negative holds here and is worth keeping: whatever
    // the top class's treatment turns out to be, no lesser class may borrow it,
    // because a player reading the colour must be reading the truth.
    const TOP: RevealClass = 4;
    const topToken = classColorToken(TOP);
    for (const classIndex of ALL_CLASSES) {
      const token = classColorToken(classIndex);
      if (classIndex === TOP) {
        expect(token).toBe(topToken);
      } else {
        expect(token).not.toBe(topToken);
      }
    }
  });

  it("no token ever names the reserved gold or price semantics", () => {
    for (const classIndex of ALL_CLASSES) {
      expect(classColorToken(classIndex)).not.toMatch(/rarity-gold|price-up|price-down/);
    }
  });
});
