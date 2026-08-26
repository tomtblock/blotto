/*
 * Reveal-loop constants — ALL magnitudes PROVISIONAL founder-tunables
 * (Q-026 pattern: structure is canon, magnitudes are tuned at the founder
 * real-device pass — reveal-spec.md §3 makes the device pass the gate on
 * every timing). Every duration the reveal animates with lives HERE, in one
 * file, so the tuning pass edits one place. No timing in this file is canon.
 *
 * Steps 3–4 (the real Motion choreography) consume these names; this step
 * ships placeholder visuals, so today the values only pace the placeholder
 * beat advancement and the tests.
 *
 * The one STRUCTURE constant is at the bottom, separated on purpose: which
 * classes get the extended tell is ratified spec (§3 Beat 4, "classes 4–5"),
 * not a feel knob.
 */

/** PROVISIONAL — taps to fully reveal the pass (spec §3 Beat 2 starting
 * value). The reducer takes this as its default; changing it here changes
 * the machine and the choreography together. */
export const TAP_COUNT = 3;

/**
 * PROVISIONAL — strain time before the come-back-later state (PRD D-03:
 * come-back triggers ONLY on genuine stall). Q-026 split, pinned at Step
 * 5a (2026-08-11): the STRUCTURE around it is ratified — the come-back
 * state and the resume-on-late-confirmation (reveal-spec §3 Beat 3) —
 * but this MAGNITUDE stays a FOUNDER-OWNED PROVISIONAL, tuned at the
 * Step 6 device pass like every other value in this file. 30 s = well
 * past normal confirmation, short enough that a user staring at a
 * genuinely stuck open isn't held hostage.
 */
export const STALL_THRESHOLD_MS = 30_000;

/** PROVISIONAL — per-tap jolt + reveal-line + light-leak animation (Beat 2). */
export const REVEAL_JOLT_DURATION_MS = 350;

/** PROVISIONAL — breathing period of the entry beat's violet glow (Beat 1). */
export const ENTRY_GLOW_PERIOD_MS = 2_400;

/** PROVISIONAL — one shake + reveal-light pulse cycle while straining
 * (Beat 3). The hold itself is UNBOUNDED by design; this paces the loop. */
export const STRAIN_PULSE_PERIOD_MS = 1_200;

/** PROVISIONAL — the tell's violet → class-colour shift (Beat 4). */
export const TELL_DURATION_MS = 1_400;

/** PROVISIONAL — the EXTENDED tell for the top classes (Beat 4: deeper dim,
 * pass lift, longer colour bleed). */
export const TELL_EXTENDED_DURATION_MS = 2_600;

/** PROVISIONAL — shell burst + bounded class-colour flash (Beat 5 — never a
 * full-screen white-out; streamability rule). */
export const UNSEAL_DURATION_MS = 900;

/** PROVISIONAL — card rise-and-settle (Beat 6). */
export const CARD_RISE_DURATION_MS = 700;

/** PROVISIONAL — POWER LEVEL count-up from zero (Beat 6; Step 4 consumes). */
export const CARD_COUNT_UP_DURATION_MS = 1_600;

/** PROVISIONAL — reveals-seal + settle animation on the failure path (3f). */
export const FAIL_SEAL_DURATION_MS = 600;

/* ---- Step 3 choreography magnitudes (same Q-026 rules) ----------------- */

/** PROVISIONAL — the takeover's entrance: backdrop deepen + pass arrival
 * (Beat 1). A fade-scale, not a shared-element move — the pass lives on a
 * different route, so a true camera move needs an overlay-not-navigation
 * restructure (reported in the Step 3 PR; not done unilaterally). */
export const ENTRY_STAGE_FADE_MS = 450;
export const ENTRY_EGG_SETTLE_MS = 600;
/** PROVISIONAL — where the pass's entrance scale starts. */
export const ENTRY_EGG_SCALE_FROM = 0.92;

/** PROVISIONAL — idle tap-affordance beckon: a subtle breathing scale on
 * the WHOLE pass while it awaits a tap (entry + between reveals). Distinct
 * from an ambient glow — this is an invitation, not decoration. */
export const BECKON_PERIOD_MS = 2_200;
export const BECKON_SCALE_MAX = 1.02;

/** PROVISIONAL — one reveal segment's draw-on (Beat 2, per tap). */
export const REVEAL_DRAW_DURATION_MS = 400;

/** PROVISIONAL — the per-tap jolt impulse (spring translate/rotate). The
 * impulse VECTORS are fixed geometry (lib/reveal/reveal-geometry.ts, NG-007);
 * these shape the rebound. */
export const JOLT_DURATION_MS = 300;
export const JOLT_REBOUND_X_RATIO = 0.6;
export const JOLT_REBOUND_ROTATE_RATIO = 0.5;

/** PROVISIONAL — violet light leaking from accumulated reveals: flare on
 * draw, then settle to a resting glow. */
export const LEAK_FADE_DURATION_MS = 500;
export const LEAK_REST_OPACITY = 0.45;

/** PROVISIONAL — strain-loop magnitudes (Beat 3). The loop is SEAMLESS and
 * CONSTANT at any hold length — it must never intensify over time
 * (intensification would imply progress that is not real; honest states).
 * Period is STRAIN_PULSE_PERIOD_MS above. */
export const STRAIN_SHAKE_PX = 2.5;
export const STRAIN_SHAKE_DEG = 1.2;
export const STRAIN_LIGHT_MIN_OPACITY = 0.35;
export const STRAIN_LIGHT_MAX_OPACITY = 0.9;

/**
 * PROVISIONAL — easing curves, mirroring tokens.css --ease-juice /
 * --ease-snap (keep in sync BY HAND: Motion takes bezier arrays, CSS vars
 * can't feed it). Same values the spike proved.
 */
export const EASE_JUICE: readonly [number, number, number, number] = [
  0.34, 1.56, 0.64, 1,
];
export const EASE_SNAP: readonly [number, number, number, number] = [
  0.22, 1, 0.36, 1,
];

/* ---- Step 4 choreography magnitudes (same Q-026 rules) ----------------- */

/** PROVISIONAL — the tell's colour BLEED (violet → class colour). Shorter
 * than the beat (TELL_DURATION_MS above) on purpose: the colour must ARRIVE
 * and hold before the unseal — a bleed that only just completes as the beat
 * ends reads as a glitch, not a climax. */
export const TELL_BLEED_DURATION_MS = 1_000;
export const TELL_EXTENDED_BLEED_DURATION_MS = 2_000;

/** PROVISIONAL — the class-colour bloom that washes the pass at the tell
 * (saturation-forward: the shift must read on a compressed phone stream). */
export const TELL_BLOOM_MAX_OPACITY = 0.9;
export const TELL_BLOOM_SCALE_FROM = 0.9;

/** PROVISIONAL — class-coloured reveal light at full bleed. BRIGHTER than the
 * violet leaks' rest (LEAK_REST_OPACITY): the tell turns the light UP, not
 * just over. */
export const TELL_LEAK_OPACITY = 0.85;

/** PROVISIONAL — the EXTENDED tell only (classes ≥ EXTENDED_TELL_MIN_CLASS):
 * how far the backdrop dims and how far the pass lifts. */
export const TELL_EXTENDED_DIM_OPACITY = 0.55;
export const TELL_EXTENDED_LIFT_PX = 18;

/** PROVISIONAL — Beat 5: the shell's vanish under the burst, the fragments'
 * flight (kept inside UNSEAL_DURATION_MS so the beat never advances with
 * shards mid-air), and how far fragments shrink over the flight. */
export const UNSEAL_SHELL_VANISH_MS = 180;
export const UNSEAL_FRAGMENT_FLIGHT_MS = 800;
export const UNSEAL_FRAGMENT_SCALE_DECAY = 0.7;

/** PROVISIONAL — the BOUNDED class-colour flash (never full-screen, never
 * white — reveal-spec §3 Beat 5). Peak-time is the keyframe fraction at
 * which the flash tops out (fast attack, slower decay). */
export const UNSEAL_FLASH_DURATION_MS = 240;
export const UNSEAL_FLASH_PEAK_OPACITY = 0.85;
export const UNSEAL_FLASH_PEAK_TIME = 0.2;
/** PROVISIONAL — reduced motion: the flash pulse becomes a STATIC
 * class-colour glow at this opacity. */
export const UNSEAL_FLASH_REDUCED_OPACITY = 0.5;

/** PROVISIONAL — Beat 6: where the card's rise starts (px below settle,
 * scale at lift-off). Rise duration is CARD_RISE_DURATION_MS above;
 * count-up duration is CARD_COUNT_UP_DURATION_MS above. */
export const CARD_RISE_FROM_Y_PX = 48;
export const CARD_RISE_SCALE_FROM = 0.9;

/* ---- Ratified STRUCTURE below this line (not feel knobs) --------------- */

/**
 * Which classes get the extended tell (the deeper dim, the lift, the longer
 * colour bleed).
 *
 * PHASE-0-REVIEW: the predecessor gave its extended tell to the top TWO of six
 * rarity tiers. Carried across by POSITION — the top two of five classes, Dragon
 * and Titan — which preserves the intent but is not a ratified decision. Which
 * classes qualify is a Phase 3 product call, and the class confers nothing either
 * way (PID §8.4): a longer animation is not a competitive advantage, which is
 * precisely why this is safe to leave as a placeholder.
 */
export const EXTENDED_TELL_MIN_CLASS = 3;
