/*
 * The Blot's FACE — pure geometry, no DOM (founder 2026-09-09: "the Blotto
 * itself should change expressions when it is being stretched in different
 * directions").
 *
 * The face is the visor (eye-band), two brows and two cheeks. All three are
 * derived from the scene's visor box, so they travel with the body and stay
 * inside the outline at every allocation. The expression is a small vector:
 *
 *   smile   −1..1   the visor's lower edge bows down (smile) or up (wince)
 *   squint   0..1   the visor thins — effort, concentration
 *   browL/R  deg    brow tilt; positive lifts the OUTER end
 *   browLift 0..1   both brows rise (surprise / delight)
 *   blush    0..1   cheek glow
 *
 * Which expression: the stat under the player's hand and which way it is
 * moving. Raising a stat is the Blot flexing that quality; lowering one
 * (the other four giving way) is a small wince. Stat order is fixed:
 * Strength, Speed, Heart, Wit, Durability (PID §4.6).
 *
 *   Strength ↑  determined: squint, brows knit down (V)
 *   Speed    ↑  eager: brows up, half-smile, slight lean (the visor tilt
 *               already leans toward the dragged corner in BlotMorph)
 *   Heart    ↑  glowing: full blush, big smile
 *   Wit      ↑  sly: one brow cocked, small smile
 *   Durability ↑ steady: soft squint, calm smile
 *   any      ↓  wince: frown, brows inward-up
 *
 * At rest the Blot wears a faint smile and a faint blush. Nothing here
 * reads the allocation for anything but the face: class, prize and scoring
 * are untouched (§8.4). Deterministic: same inputs, same face — the still
 * renderer uses the REST face so stills stay byte-identical per allocation.
 */

export interface Expression {
  smile: number;
  squint: number;
  browL: number;
  browR: number;
  browLift: number;
  blush: number;
}

export const REST_EXPRESSION: Expression = {
  smile: 0.18,
  squint: 0,
  browL: 6,
  browR: 6,
  browLift: 0,
  blush: 0.22,
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** The face for a dial being moved: `stat` 0..4, `direction` +1 raising, −1 lowering, `strength` 0..1. */
export function expressionFor(stat: number | null, direction: number, strength: number): Expression {
  const k = clamp01(strength);
  if (stat === null || direction === 0 || k === 0) return REST_EXPRESSION;
  const mix = (target: Expression): Expression => ({
    smile: REST_EXPRESSION.smile + (target.smile - REST_EXPRESSION.smile) * k,
    squint: REST_EXPRESSION.squint + (target.squint - REST_EXPRESSION.squint) * k,
    browL: REST_EXPRESSION.browL + (target.browL - REST_EXPRESSION.browL) * k,
    browR: REST_EXPRESSION.browR + (target.browR - REST_EXPRESSION.browR) * k,
    browLift: REST_EXPRESSION.browLift + (target.browLift - REST_EXPRESSION.browLift) * k,
    blush: REST_EXPRESSION.blush + (target.blush - REST_EXPRESSION.blush) * k,
  });
  if (direction < 0) {
    // Lowering any stat: a small wince.
    return mix({ smile: -0.55, squint: 0.35, browL: -22, browR: -22, browLift: 0.15, blush: 0.15 });
  }
  switch (stat) {
    case 0: // Strength — determined
      return mix({ smile: 0.05, squint: 0.7, browL: -26, browR: -26, browLift: 0, blush: 0.3 });
    case 1: // Speed — eager
      return mix({ smile: 0.55, squint: 0.1, browL: 18, browR: 18, browLift: 0.7, blush: 0.35 });
    case 2: // Heart — glowing
      return mix({ smile: 1, squint: 0.15, browL: 12, browR: 12, browLift: 0.4, blush: 1 });
    case 3: // Wit — sly
      return mix({ smile: 0.45, squint: 0.3, browL: -4, browR: 34, browLift: 0.25, blush: 0.25 });
    case 4: // Durability — steady
      return mix({ smile: 0.3, squint: 0.4, browL: 2, browR: 2, browLift: 0, blush: 0.3 });
    default:
      return REST_EXPRESSION;
  }
}

export interface VisorBox {
  cx: number;
  cy: number;
  width: number;
  height: number;
  rx: number;
}

const f2 = (v: number) => v.toFixed(2);

/**
 * The visor as a rounded box whose LOWER edge bows with `smile`, thinned by
 * `squint`. A closed path; serialised at two decimals (still determinism).
 */
export function visorPath(v: VisorBox, e: Expression): string {
  const h = v.height * (1 - 0.45 * clamp01(e.squint));
  const rx = Math.min(v.rx, h / 2);
  const x0 = v.cx - v.width / 2;
  const x1 = v.cx + v.width / 2;
  const yt = v.cy - h / 2;
  const yb = v.cy + h / 2;
  const bow = e.smile * h * 0.85;
  return (
    `M${f2(x0 + rx)} ${f2(yt)}` +
    `H${f2(x1 - rx)}` +
    `Q${f2(x1)} ${f2(yt)} ${f2(x1)} ${f2(yt + rx)}` +
    `V${f2(yb - rx)}` +
    `Q${f2(x1)} ${f2(yb)} ${f2(x1 - rx)} ${f2(yb)}` +
    `Q${f2(v.cx)} ${f2(yb + bow)} ${f2(x0 + rx)} ${f2(yb)}` +
    `Q${f2(x0)} ${f2(yb)} ${f2(x0)} ${f2(yb - rx)}` +
    `V${f2(yt + rx)}` +
    `Q${f2(x0)} ${f2(yt)} ${f2(x0 + rx)} ${f2(yt)}` +
    'Z'
  );
}

export interface Brow {
  x: number;
  y: number;
  length: number;
  thickness: number;
  /** Rotation about the brow's centre, degrees; negative = outer end down. */
  angle: number;
}

/** Two brows above the visor. Angles follow the expression; lift raises both. */
export function brows(v: VisorBox, e: Expression): { left: Brow; right: Brow } {
  const length = Math.max(60, v.width * 0.3);
  const thickness = Math.max(14, v.height * 0.26);
  const gap = v.height * 0.55 + e.browLift * v.height * 0.5;
  const y = v.cy - v.height / 2 - gap;
  const dx = v.width * 0.27;
  return {
    left: { x: v.cx - dx, y, length, thickness, angle: -e.browL },
    right: { x: v.cx + dx, y, length, thickness, angle: e.browR },
  };
}

export interface Cheek {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  opacity: number;
}

/** Two cheeks below the visor's outer ends; opacity is the blush. */
export function cheeks(v: VisorBox, e: Expression): { left: Cheek; right: Cheek } {
  const cy = v.cy + v.height * 0.95;
  const dx = v.width * 0.46;
  const rx = Math.max(36, v.width * 0.16);
  const ry = rx * 0.62;
  const opacity = 0.5 * clamp01(e.blush);
  return {
    left: { cx: v.cx - dx, cy, rx, ry, opacity },
    right: { cx: v.cx + dx, cy, rx, ry, opacity },
  };
}
