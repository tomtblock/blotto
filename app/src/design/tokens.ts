/*
 * The design system's SINGLE SOURCE OF TRUTH (D1, master prompt v3).
 *
 * Direction (D-UI-1): a competition arena at night — deep navy-black base
 * (blue-black, never neutral grey), ONE electric accent for action
 * (floodlight blue), ONE warm accent for prize and celebration (molten
 * amber), high-contrast type. Bright, saturated, confident; nothing
 * slot-machine-coded (no reels, no coin showers, no gold-rain).
 *
 * `src/styles/tokens.css` mirrors these values as CSS custom properties for
 * Tailwind's utilities; `tokens.test.ts` asserts the two files agree, so a
 * value edited in one place without the other fails the suite instead of
 * shipping a two-faced palette.
 *
 * Reservation rules (carried discipline — structural, not advisory):
 *   - priceUp / priceDown → win/loss semantics ONLY. Never decorative.
 *   - prize / prizeHot    → prize amounts and celebration moments ONLY —
 *     the number a player is paid always wears this colour, and nothing
 *     else does.
 *   - rarityGold*         → the top class's art moments ONLY (never
 *     prizes; prize amber ≠ class gold, so neither can impersonate the
 *     other).
 *   - class0..class4      → the five cosmetic classes (PID §3). A class
 *     confers nothing (PID §8.4): art direction, never a signal of
 *     advantage. Hues are founder-owned placeholders (PID D2).
 */

export const palette = {
  /* Surfaces — dark arena, the only mode. */
  base: '#070b14',
  raised: '#0d1420',
  overlay: '#131c2e',
  line: '#1d2942',

  /* Text. */
  ink: '#edf2fb',
  inkMuted: '#7e8aa3',

  /* THE action accent — stadium floodlight blue. Buttons, focus, live. */
  brand: '#3d8bff',
  brandHot: '#66b2ff',
  brandDeep: '#1f5fcc',

  /* THE celebration accent — molten amber. Prize amounts, paid moments. */
  prize: '#ffaa33',
  prizeHot: '#ffc96b',

  /* RESERVED functional semantics. */
  priceUp: '#16c784',
  priceDown: '#ea3943',

  /* RESERVED for the top class's art moments only. */
  rarityGold: '#ffd24a',
  rarityGoldHot: '#ffb300',

  /* Class ladder placeholders (founder-owned, PID D2). */
  class0: '#9e9ea7',
  class1: '#7c8db5',
  class2: '#a855f7',
  class3: '#f472b6',
  class4: '#ffd24a',
} as const;

/*
 * Type roles. The display face is Big Shoulders Display — a condensed
 * athletic face built for scoreboards and stadium signage, which is exactly
 * what prize amounts, ranks and countdowns are. Body is Space Grotesk;
 * addresses and hashes stay JetBrains Mono. NUMBERS ARE ALWAYS TABULAR:
 * every numeric readout sets `font-variant-numeric: tabular-nums` (the
 * `.tnum` utility) so a ticking countdown never jitters sideways.
 */
export const type = {
  display: 'var(--font-big-shoulders)',
  body: 'var(--font-space-grotesk)',
  mono: 'var(--font-jetbrains-mono)',
  /* Scale (px @ 16 root): name → [size, lineHeight]. */
  scale: {
    caption: [12, 16],
    body: [15, 22],
    lead: [18, 26],
    title: [24, 30],
    headline: [34, 38],
    /* The moment sizes — display face only. */
    moment: [56, 58],
    arena: [88, 88],
  },
} as const;

/* Spacing: a 4px base scale. Components use Tailwind's default scale (also
 * 4px-based); this list is the documented contract, not a parallel system. */
export const spacing = [0, 4, 8, 12, 16, 24, 32, 48, 64, 96] as const;

/*
 * Motion (UI constitution PART 4): the grammar's shared physics. Motion on
 * this site is a language with five words — LIGHT, FROST, WEIGHT, WARMTH,
 * TRAVEL — each permanently bound to one game concept (see
 * `src/design/grammar.ts`). This object owns the raw physics those words
 * share; no page invents its own values.
 *
 *   fast — micro-feedback and every exit (exits are always faster than
 *          their enters).
 *   base — LIGHT and standard enters.
 *   slow — FROST and on-screen morphs.
 *
 * Two curves site-wide: one ease-out for enters and LIGHT, one ease-in-out
 * for morphs, FROST and TRAVEL. The single spring is for gesture-driven
 * release only (the pentagon vertex settling under a thumb) — nothing else
 * springs, nothing overshoots.
 */
export const motion = {
  duration: {
    fast: 150,
    base: 250,
    slow: 400,
  },
  easing: {
    /* Enters + LIGHT. Strong curve — built-in CSS easings are too weak. */
    out: 'cubic-bezier(0.23, 1, 0.32, 1)',
    /* Morphs, FROST, TRAVEL. */
    inOut: 'cubic-bezier(0.77, 0, 0.175, 1)',
  },
  /* Gesture-driven release ONLY — the settle of a well-made drawer. */
  spring: { type: 'spring', duration: 0.45, bounce: 0.15 },
} as const;

/* Elevation: shadow recipes over the navy base. The glow tiers belong to
 * the two accents only — an elevated neutral card uses depth, never glow. */
export const elevation = {
  card: '0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 8px 24px rgba(0, 0, 0, 0.45)',
  sheet: '0 -12px 48px rgba(0, 0, 0, 0.6)',
  glowAction: '0 0 24px rgba(61, 139, 255, 0.35)',
  glowPrize: '0 0 32px rgba(255, 170, 51, 0.3)',
} as const;

export type PaletteToken = keyof typeof palette;
