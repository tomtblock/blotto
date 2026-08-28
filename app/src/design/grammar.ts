/*
 * The motion grammar (UI constitution PART 4.1).
 *
 * Motion on this site is a language with five words, each PERMANENTLY bound
 * to one game concept. No animation may use a word to mean something else,
 * and no animation may exist outside these five words — anything
 * unclassifiable is deleted, not shipped. When two screens animate the same
 * concept they use the same word the same way; that is what keeps every
 * animation in tune with every other.
 *
 *   LIGHT  — information becoming true. Revelation, verification, a stat
 *            winning. Luminance rises once, ease-out, ~250ms; travels as a
 *            single pass, never strobes. One accent hue site-wide: the same
 *            light that invites you in (button glow) is the light that
 *            reveals the truth (verify green, winning stats).
 *   FROST  — a commitment sealed. Encrypted, final, unreadable by anyone,
 *            operator included. A crystalline blur condenses over the
 *            object (400ms ease-in-out); frosted objects are visibly
 *            PRESENT but unreadable. De-frost is FROST reversed and always
 *            simultaneous for every object in a pool — simultaneity is the
 *            fairness made visible. FROST is the only blur on the site.
 *   WEIGHT — finality. A thing placed that cannot be moved. Scale
 *            1 → 0.96 → 1 with a hard settle, ≤200ms; a low landing, never
 *            a bounce. Never applies to reversible actions — those get
 *            plain 150ms transitions.
 *   WARMTH — live human presence. A resting glow whose intensity scales
 *            with REAL occupancy (on-chain data only); one soft rise per
 *            real event; never oscillates while idle.
 *   TRAVEL — value or data moving, honestly. Objects move along a visible
 *            path, ease-in-out, origin and destination both on screen;
 *            money never teleports and never multiplies visually.
 *
 * Grammar rules:
 *   1. One LIGHT event and one WARMTH source maximum per viewport at rest.
 *      One hero animation per screen; everything else is micro-feedback
 *      under 250ms. If two things want attention simultaneously, one loses.
 *   2. Everything else is silence: legal copy, the gate, resting screens.
 *   3. Reduced motion (PART 4.3): LIGHT → instant state change · FROST →
 *      instant blur toggle · WEIGHT → none · WARMTH → static glow at
 *      correct intensity · TRAVEL → crossfade with both endpoints labeled.
 *      The global collapse in tokens.css handles the CSS classes; JS-driven
 *      TRAVEL sequences branch on the `useReducedMotion` hook.
 *
 * The class names below are the ONLY sanctioned way to invoke a word from
 * a component; the physics live in src/styles/tokens.css and are asserted
 * against this file by grammar.test.ts. Durations and curves come from
 * ./tokens — no page invents its own values.
 */

import { motion } from './tokens';

/** LIGHT — information becoming true. */
export const light = {
  /** One-shot luminance rise on the element itself (~250ms ease-out). */
  in: 'animate-light-in',
  /**
   * A single traveling luminance pass. Put on an absolutely-positioned
   * overlay inside an `overflow-hidden` parent; it sweeps once and ends.
   */
  pass: 'animate-light-pass',
} as const;

/**
 * FROST — a commitment sealed. Markup contract (owned by the shared
 * <Frost> component): a container carrying `data-frosted`, a `.frost-sharp`
 * layer (the readable object) and a `.frost-veil` layer (the pre-blurred,
 * crystalline presentation). Only opacity animates; the blur itself is
 * static, so compositing stays cheap during the simultaneous 64-entry
 * de-frost.
 */
export const frostAttr = (frosted: boolean) => ({
  'data-frosted': frosted ? 'true' : 'false',
});

/** WEIGHT — finality. The stamp; ≤200ms, no bounce. */
export const weight = {
  stamp: 'animate-stamp',
} as const;

/** WARMTH — live human presence. */
export const warmth = {
  /**
   * The resting glow layer. Static by construction; its intensity is the
   * CSS variable `--warmth` (0..1), set ONLY from real occupancy.
   */
  glow: 'warmth-glow',
  /** One soft rise per real event (a seat filling), then rest. */
  rise: 'animate-warmth-rise',
} as const;

/**
 * TRAVEL — value or data moving, honestly. TRAVEL is choreographed in JS
 * (Motion / WAAPI) because paths are scene-specific, but its physics are
 * fixed here: the curve, and the two sanctioned journey lengths.
 */
export const travel = {
  easing: motion.easing.inOut,
  /** The entry-split (80/20) — the business model rendered honestly. */
  splitMs: 800,
  /** Sealed battles traveling to the pool at submit. */
  toPoolMs: 600,
} as const;

/** Micro-feedback — everything that is not a grammar word and not silence. */
export const micro = {
  enter: 'animate-enter',
  enterFast: 'animate-enter-fast',
  exit: 'animate-exit',
} as const;

/** The ONLY shake on the site: a Verify check failure. */
export const verifyShake = 'animate-verify-shake';

/**
 * The single spring, for gesture-driven release only (a pentagon vertex
 * settling under the thumb). Nothing else springs.
 */
export const gestureSpring = motion.spring;
