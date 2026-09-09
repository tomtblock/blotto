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

/*
 * Founder 2026-09-09: "make this part more intuitive — TAP THE EGG TO SEE
 * YOUR RARITY — there should be some words explaining what is going on
 * here, how the rarity works, how the rarity doesn't affect the balance."
 * Facts from PID §3 (the rarity table) and the program's published bag
 * (LAUNCH_CLASS_COUNTERS = 38 · 15 · 7 · 3 · 1 of 64); the no-effect line
 * restates PID §8.4 / TECH-ARCH §4 — class is read by nothing in scoring.
 */
export const EGG_TITLE = "Tap the egg to hatch your character pass";
export const EGG_WHAT =
  "Your entry is in and your seven battles are sealed. Each tap cracks the shell a little; when the network confirms your seat, the shell bursts and shows which of five looks your pass has.";
export const EGG_RARITY_TITLE = "How rarity works";
export const EGG_RARITY =
  "Every pool of 64 carries a fixed bag of five looks — 38 Goblin, 15 Knight, 7 Wizard, 3 Dragon and 1 Titan — and each entry draws one from what is left. The draw comes from a published random seed and is replayable by anyone from on-chain data.";
export const EGG_NO_EFFECT =
  "The look is cosmetic and nothing else. It changes no stat, no battle, no ranking and no prize — a Titan's Strength is worth exactly a Goblin's. Only the sealed battles decide who is paid.";
export const EGG_CONFIRMING =
  "Still confirming with the network. Nothing more is needed from you — keep tapping, or simply wait.";
