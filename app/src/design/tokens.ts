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

  /* ————————————————————————————————————————————————————————————————
   * BLOT WORLD (v4, 2026-09-06) — the two-layer system.
   *
   * Brand layer (surfaces, mascot, celebration): the page is hot pink, the
   * Blot and inflated display type are yellow, cream/pale-pink are light
   * panels and quiet surfaces, deep magenta is depth and hover-on-pink,
   * coral is the second Blot in a pair — accent only.
   *
   * Game layer (every number, rule and control): dark plum cards.
   * gameAction (pink) is the ONLY colour that spends or commits — Enter,
   * Pay entry, Seal — and a pink pill is the only pink object permitted
   * inside a plum card. gamePrize (yellow) is worn ONLY by amounts a
   * player is paid; the Blot (also yellow) never shares a frame with a
   * paid amount or a stat number, so yellow can never be both at once.
   *
   * The layers share hexes (pink appears as brandPink and gameAction,
   * yellow as brandYellow and gamePrize) but never share a surface —
   * the DUPLICATE NAMES ARE THE POINT: a consumer says which job the
   * colour is doing, so the reservation rules stay greppable.
   *
   * The arena tokens above remain exported until every consumer has
   * migrated; they are deleted together in the final PR of the v4
   * sequence, never silently before.
   * ———————————————————————————————————————————————————————————————— */
  brandPink: '#ff7ac8',
  brandYellow: '#ffde59',
  /* The vinyl's edge: gradient rim and seam stroke on the Blot's body.
   * Material rendering only — never a surface, never type. */
  brandYellowDeep: '#e6b800',
  /* The Blot's visor. Material, like the seam — never a surface. */
  blotVisor: '#2a1030',
  brandCream: '#fff6ec',
  brandPalePink: '#ffc7e3',
  brandDeepMagenta: '#d63c8c',
  brandCoral: '#ff9a6b',

  gameBase: '#5e1b40',
  gameRaised: '#72244f',
  gameInk: '#fff6ec',
  gameInkMuted: '#ffc7e3',
  gameAction: '#ff7ac8',
  gamePrize: '#ffde59',
  /* Dials, hardware, object details — moved from the brand layer in the
   * candy revision (2026-09-06): hardware belongs with the controls. */
  gameSlate: '#4b4f5c',

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
    /* v4: inflated brand type (Blot world) — page titles and section
     * openers on brand surfaces only. It never carries a number that
     * matters; everything a player must read to act stays body-on-plum. */
    inflated: [128, 116],
  },
} as const;

/* Spacing: a 4px base scale. Components use Tailwind's default scale (also
 * 4px-based); this list is the documented contract, not a parallel system. */
export const spacing = [0, 4, 8, 12, 16, 24, 32, 48, 64, 96] as const;

/*
 * Motion (D1): a small named vocabulary, used consistently. Motion
 * CELEBRATES outcomes; it never nags — nothing loops to attract attention,
 * nothing shakes to rush anyone. `prefers-reduced-motion` collapses all of
 * it (global rule in tokens.css).
 *
 *   reveal     — a staged entrance for outcome moments (battle rows, the
 *                rank). Rises + fades with a slight overshoot.
 *   settle     — state coming to rest (a card landing, a sheet docking).
 *   pulse-once — a SINGLE emphasis beat (seat count ticking up). One shot,
 *                by definition: it never repeats on its own.
 *   rise       — small entrance for secondary content.
 */
export const motion = {
  duration: {
    reveal: 700,
    settle: 450,
    pulseOnce: 600,
    rise: 350,
  },
  easing: {
    /* Overshoot — celebration moments only. */
    juice: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    /* Fast-out — interface state changes. */
    snap: 'cubic-bezier(0.22, 1, 0.36, 1)',
    /* Even glide — long reveals. */
    glide: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
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
