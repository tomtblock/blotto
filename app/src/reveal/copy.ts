/*
 * Every user-facing string the reveal surface renders.
 *
 * Filled per master prompt v3 D-UI-3, against the forbidden and preferred
 * vocabulary in PID §8.7 (see `CONTRIBUTING.md` → "The language gate" for the
 * grep that enforces it). Brand voice stays founder-reserved — the founder may
 * re-voice any string here.
 *
 * Keeping the strings in one module — rather than inline in the components — is
 * the point: the language audit reads one file, and a component that inlines a
 * string instead of importing from here has stepped outside the gate.
 */

/** Accessible label for the tap target that progresses the unsealing. */
export const PASS_TAP_ARIA = "Continue revealing your character pass";
