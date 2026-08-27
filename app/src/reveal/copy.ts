/*
 * Every user-facing string the reveal surface renders.
 *
 * ALL PLACEHOLDERS. The predecessor's copy module was deliberately NOT carried —
 * its voice is the thing the extraction exists to leave behind, and PID §8.7 makes
 * the vocabulary a legal-position rule rather than a matter of tone. Each constant
 * below is a `TODO_COPY(...)` marker keyed by where it renders.
 *
 * The Phase 3 language audit fills them (PID §10, compliance item C12, which blocks
 * launch). When it does, it writes against the forbidden and preferred vocabulary
 * in PID §8.7 — read it there rather than from a copy, and see
 * `CONTRIBUTING.md` → "The language gate" for the grep that enforces it.
 *
 * Keeping the strings in one module — rather than inline in the components — is the
 * point: the audit reads one file, and a component that inlines a string instead of
 * importing from here has stepped outside the gate.
 */

/** Accessible label for the tap target that progresses the unsealing. */
export const PASS_TAP_ARIA = "TODO_COPY(reveal-stage.pass-tap-aria)";
