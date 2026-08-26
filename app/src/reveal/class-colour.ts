/*
 * Class → colour-token mapping for the reveal's coloured beats (10.C Step 4).
 *
 * THE ONE DOOR class colour walks through into the reveal stage: the stage
 * components never write a class token literal (stage-discipline.test.ts
 * scans for that), they call `classColorToken` with the class the machine's
 * visual projection hands them — and the projection carries no class field
 * before the tell (machine.ts, type-level). Mapping + type guard together
 * make "gold before a class-5 tell" unrepresentable in source.
 *
 * D-03a / reveal-spec §1: gold strictly = class 5. `--color-class-5` IS the
 * gold value (tokens.css pins them equal by design), so the negative
 * guarantee lives at the token-NAME level here (classes 0–4 can never
 * produce the class-5 token — class-colour.test.ts pins it exhaustively) and
 * at the RENDERED level in the visual guard (which resolves the tokens and
 * sweeps the page).
 */

import type { RevealClass } from "./types";

/** The ADR-021 ladder, class index → design token (tokens.css). Exhaustive
 * and closed: exactly these five, nothing else is a class colour. */
export const CLASS_COLOR_TOKENS: Readonly<Record<RevealClass, string>> = {
  0: "var(--color-class-0)",
  1: "var(--color-class-1)",
  2: "var(--color-class-2)",
  3: "var(--color-class-3)",
  4: "var(--color-class-4)",
};

/** The drawn class's colour token — the reveal stage's only class-colour
 * source. */
export function classColorToken(classIndex: RevealClass): string {
  return CLASS_COLOR_TOKENS[classIndex];
}
