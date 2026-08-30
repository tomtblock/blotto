/*
 * Arena playback constants — ALL magnitudes PROVISIONAL founder-tunables
 * (the Q-026 pattern carried from src/reveal/constants.ts): every duration
 * and magnitude the arena animates with lives HERE, in one file, so a
 * device-tuning pass edits one place. The arena's stage-discipline scan
 * (src/arena/stage-discipline.test.ts) allows only 0 and 1 as literals in
 * animation props — everything else must be one of these names.
 */

/** PROVISIONAL — beat durations (the stage's one timer reads these). */
export const MATCHUP_INTRO_MS = 1_400;
export const ROUND_INTRO_MS = 1_000;
export const MOVE_CALL_MS = 900;
export const MOVE_LAND_MS = 700;
export const ROUND_RESULT_MS = 1_500;

/** PROVISIONAL — the attacker's lunge (translate toward the opponent). */
export const LUNGE_PX = 22;
export const LUNGE_DURATION_MS = 320;

/** PROVISIONAL — the KO'd creature's fall (opacity + sink; reduced motion
 * drops the sink and keeps the fade). */
export const KO_SINK_PX = 26;
export const KO_FADE_DURATION_MS = 700;

/** PROVISIONAL — the defender's hit shake and the tied-stat clash pulse. */
export const HIT_SHAKE_PX = 6;
export const HIT_SHAKE_DURATION_MS = 300;
export const CLASH_SCALE_MAX = 1.06;

/** PROVISIONAL — round/matchup transitions (crossfades). */
export const STAGE_FADE_MS = 350;

/** PROVISIONAL — creature entrance settle on round intro. */
export const ENTER_SCALE_FROM = 0.9;
export const ENTER_SETTLE_MS = 450;

/** PROVISIONAL — the lobby seat pop-in. */
export const SEAT_POP_SCALE_FROM = 0.6;
export const SEAT_POP_DURATION_MS = 400;

/**
 * PROVISIONAL — easing curves, mirroring tokens.css --ease-juice /
 * --ease-snap (kept in sync BY HAND, the reveal-constants convention:
 * Motion takes bezier arrays, CSS vars can't feed it).
 */
export const EASE_JUICE: readonly [number, number, number, number] = [0.34, 1.56, 0.64, 1];
export const EASE_SNAP: readonly [number, number, number, number] = [0.22, 1, 0.36, 1];
