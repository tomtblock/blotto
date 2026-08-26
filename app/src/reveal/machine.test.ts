/*
 * Reveal beat-machine guards (10.C Step 2) — same rigour as
 * a pure-reducer suite. The invariants pinned here:
 *
 *  - NG-007: class influences NOTHING before the tell — the visual sequence
 *    through the last pre-tell beat is deep-equal across all six classes, for
 *    every confirmation-arrival position.
 *  - Confirmed-before-reveal: exhaustive reachability search over the full
 *    event alphabet — no state reachable without a `tx_confirmed` event
 *    carries class data, and tell/unseal/card are unreachable outright.
 *  - Stall ≠ failure: `stalled` enters ONLY via (strain, stall_timeout);
 *    `failed` ONLY via `tx_failed`. Distinct beats, distinct copy keys
 *    (copy.test.ts owns the string side).
 *  - Resume-from-stalled is RATIFIED canon (founder, 2026-08-11 — 10.C
 *    Step 5a): a confirmation landing on the come-back screen resumes the
 *    reveal at the tell; never a restart, never a dropped outcome.
 *  - Held confirmation passes through strain instantly; extra taps are
 *    no-ops; retry from failed is a clean pre-entry reset with no state
 *    field that could imply a spent entry.
 */

import { describe, expect, it } from "vitest";
import type { TxFailure } from "@/tx/types";
import {
  INITIAL_REVEAL_STATE,
  replayReveal,
  revealReducer,
  revealVisual,
  type RevealEvent,
  type RevealState,
  type RevealVisual,
} from "./machine";
import { EXTENDED_TELL_MIN_CLASS, TAP_COUNT } from "./constants";
import { fixtureRevealOutcome } from "./fixtures";
import type { RevealClass } from "./types";

const CLASSES: RevealClass[] = [0, 1, 2, 3, 4];

const FAILURE: TxFailure = {
  kind: "rpc-failure",
  message: "test failure",
  detail: "machine.test fixture",
  broadcast: true,
};

const tap: RevealEvent = { kind: "tap" };
const confirmed = (classIndex: RevealClass): RevealEvent => ({
  kind: "tx_confirmed",
  outcome: fixtureRevealOutcome(classIndex),
});
const failed: RevealEvent = { kind: "tx_failed", failure: FAILURE };
const stallTimeout: RevealEvent = { kind: "stall_timeout" };
const beatElapsed: RevealEvent = { kind: "beat_elapsed" };
const dismiss: RevealEvent = { kind: "dismiss" };
const retry: RevealEvent = { kind: "retry" };

/** The bounded event alphabet the exhaustive searches range over. */
const alphabet = (classIndex: RevealClass): RevealEvent[] => [
  tap,
  confirmed(classIndex),
  failed,
  stallTimeout,
  beatElapsed,
  dismiss,
  retry,
];

const taps = (n: number): RevealEvent[] => Array(n).fill(tap);

/** True when a state's serialized form carries class data anywhere. */
function carriesClassData(state: RevealState): boolean {
  return JSON.stringify(state).includes('"class"');
}

/**
 * Exhaustive reachability: fold every event over every discovered state to
 * a fixpoint, tracking whether a `tx_confirmed` was consumed on the way.
 * The state space is small by construction, so this terminates fast.
 */
function searchReachable(classIndex: RevealClass): {
  /** Every (state, sawConfirmed) node discovered. */
  nodes: { state: RevealState; sawConfirmed: boolean }[];
  /** Every transition taken: from --event--> to. */
  transitions: { from: RevealState; event: RevealEvent; to: RevealState }[];
} {
  const events = alphabet(classIndex);
  const seen = new Map<string, { state: RevealState; sawConfirmed: boolean }>();
  const transitions: {
    from: RevealState;
    event: RevealEvent;
    to: RevealState;
  }[] = [];
  const key = (s: RevealState, c: boolean) => `${c}|${JSON.stringify(s)}`;
  const queue: { state: RevealState; sawConfirmed: boolean }[] = [
    { state: INITIAL_REVEAL_STATE, sawConfirmed: false },
  ];
  seen.set(key(INITIAL_REVEAL_STATE, false), queue[0]);
  while (queue.length > 0) {
    const node = queue.pop();
    if (!node) break;
    for (const event of events) {
      const next = revealReducer(node.state, event);
      const sawConfirmed = node.sawConfirmed || event.kind === "tx_confirmed";
      if (next !== node.state) {
        transitions.push({ from: node.state, event, to: next });
      }
      const k = key(next, sawConfirmed);
      if (!seen.has(k)) {
        const entry = { state: next, sawConfirmed };
        seen.set(k, entry);
        queue.push(entry);
      }
    }
  }
  return { nodes: [...seen.values()], transitions };
}

describe("revealReducer — NG-007: class is invisible through the last pre-tell beat", () => {
  it("visual sequences are deep-equal across ALL classes for EVERY confirmation-arrival position", () => {
    // Position p = confirmation lands after p taps (0 = before the first
    // tap; TAP_COUNT = confirmation lands only after full reveal, i.e. the
    // strain path).
    for (let position = 0; position <= TAP_COUNT; position++) {
      const perClass = CLASSES.map((classIndex) => {
        const events = [
          ...taps(position),
          confirmed(classIndex),
          ...taps(TAP_COUNT - position),
        ];
        const visuals: RevealVisual[] = [];
        let state = INITIAL_REVEAL_STATE;
        for (const event of events) {
          state = revealReducer(state, event);
          visuals.push(revealVisual(state));
        }
        // Everything before the tell is the class-neutral zone under test.
        const tellAt = visuals.findIndex((v) => v.beat === "tell");
        expect(tellAt, `class ${classIndex} @ position ${position} reached no tell`)
          .toBeGreaterThanOrEqual(0);
        return visuals.slice(0, tellAt);
      });
      for (const [i, sequence] of perClass.entries()) {
        expect(
          sequence,
          `class ${CLASSES[i]} pre-tell sequence diverged @ position ${position}`,
        ).toEqual(perClass[0]);
      }
    }
  });

  it("no pre-tell visual variant carries a class field at all", () => {
    for (const classIndex of CLASSES) {
      for (const { state } of searchReachable(classIndex).nodes) {
        const visual = revealVisual(state);
        if (["entry", "revealing", "strain", "failed", "stalled", "settled"]
          .includes(visual.beat)) {
          expect("class" in visual, `${visual.beat} leaked a class`).toBe(false);
        }
      }
    }
  });
});

describe("revealReducer — confirmed-before-reveal (exhaustive search)", () => {
  it("no state reachable without tx_confirmed carries class data", () => {
    for (const classIndex of CLASSES) {
      for (const { state, sawConfirmed } of searchReachable(classIndex).nodes) {
        if (!sawConfirmed) {
          expect(
            carriesClassData(state),
            `class data before confirmation: ${JSON.stringify(state)}`,
          ).toBe(false);
          expect(["tell", "unseal", "card"]).not.toContain(state.beat);
        }
      }
    }
  });

  it("held confirmation is recorded, not applied — revealing continues", () => {
    const state = replayReveal([tap, confirmed(3)]);
    expect(state.beat).toBe("revealing");
    // Held-but-unapplied confirmation is invisible to the render layer.
    expect(revealVisual(state)).toEqual({ beat: "revealing", tapsSoFar: 1 });
  });

  it("held confirmation passes through strain instantly on the final tap", () => {
    const visuals: RevealVisual[] = [];
    let state = INITIAL_REVEAL_STATE;
    for (const event of [confirmed(4), ...taps(TAP_COUNT)]) {
      state = revealReducer(state, event);
      visuals.push(revealVisual(state));
    }
    expect(state.beat).toBe("tell");
    expect(visuals.some((v) => v.beat === "strain")).toBe(false);
  });

  it("without a held confirmation the final tap strains, and confirmation then tells", () => {
    const strained = replayReveal(taps(TAP_COUNT));
    expect(strained).toEqual({ beat: "strain" });
    const told = revealReducer(strained, confirmed(1));
    expect(revealVisual(told)).toEqual({ beat: "tell", class: 1, extended: false });
  });

  it("the extended tell is exactly the classes constants.ts nominates", () => {
    // Asserted against the constant, not a literal: WHICH classes get the
    // extended tell is a Phase 3 product call (see EXTENDED_TELL_MIN_CLASS), and
    // this test should follow that decision rather than pin a second copy of it.
    for (const classIndex of CLASSES) {
      const state = replayReveal([...taps(TAP_COUNT), confirmed(classIndex)]);
      expect(revealVisual(state)).toEqual({
        beat: "tell",
        class: classIndex,
        extended: classIndex >= EXTENDED_TELL_MIN_CLASS,
      });
    }
  });

  it("first confirmation wins — a duplicate never rewrites the outcome", () => {
    const state = replayReveal([confirmed(4), confirmed(0), ...taps(TAP_COUNT)]);
    expect(revealVisual(state)).toEqual({ beat: "tell", class: 4, extended: true });
  });
});

describe("revealReducer — NG-007: extra taps change nothing", () => {
  it("taps after the final reveal tap are no-ops in every downstream beat", () => {
    const posts: RevealState[] = [
      replayReveal(taps(TAP_COUNT)), // strain
      replayReveal([...taps(TAP_COUNT), stallTimeout]), // stalled
      replayReveal([...taps(TAP_COUNT), failed]), // failed
      replayReveal([...taps(TAP_COUNT), confirmed(2)]), // tell
      replayReveal([...taps(TAP_COUNT), confirmed(2), beatElapsed]), // unseal
      replayReveal([...taps(TAP_COUNT), confirmed(2), beatElapsed, beatElapsed]), // card
      replayReveal([
        ...taps(TAP_COUNT),
        confirmed(2),
        beatElapsed,
        beatElapsed,
        dismiss,
      ]), // settled
    ];
    for (const state of posts) {
      let current = state;
      for (let i = 0; i < 50; i++) current = revealReducer(current, tap);
      // Reference equality — the no-op returns the SAME object.
      expect(current).toBe(state);
    }
  });
});

describe("revealReducer — stall vs failure are distinct and separately gated", () => {
  it("stalled enters ONLY via (strain, stall_timeout); failed ONLY via tx_failed", () => {
    for (const classIndex of CLASSES) {
      for (const { from, event, to } of searchReachable(classIndex).transitions) {
        if (to.beat === "stalled") {
          expect(from.beat).toBe("strain");
          expect(event.kind).toBe("stall_timeout");
        }
        if (to.beat === "failed") {
          expect(event.kind).toBe("tx_failed");
        }
      }
    }
  });

  it("a stall timer racing past confirmation is a harmless no-op", () => {
    const told = replayReveal([...taps(TAP_COUNT), confirmed(2)]);
    expect(revealReducer(told, stallTimeout)).toBe(told);
  });

  it("failure is reachable from entry, revealing, strain AND stalled — never after confirmation", () => {
    expect(replayReveal([failed]).beat).toBe("failed");
    expect(replayReveal([tap, failed]).beat).toBe("failed");
    expect(replayReveal([...taps(TAP_COUNT), failed]).beat).toBe("failed");
    expect(
      replayReveal([...taps(TAP_COUNT), stallTimeout, failed]).beat,
    ).toBe("failed");
    // Held confirmation shields the reveal beats from a stale failure…
    const held = replayReveal([confirmed(3), tap]);
    expect(revealReducer(held, failed)).toBe(held);
    // …and every post-tell beat ignores it outright.
    const told = replayReveal([...taps(TAP_COUNT), confirmed(3)]);
    expect(revealReducer(told, failed)).toBe(told);
  });

  it("late confirmation while stalled RESUMES the reveal — never restarts, never drops the outcome (founder-RATIFIED 2026-08-11)", () => {
    const stalled = replayReveal([...taps(TAP_COUNT), stallTimeout]);
    expect(stalled).toEqual({ beat: "stalled" });
    // Resume, not restart: straight to the tell, no second entry/revealing…
    const resumed = revealReducer(stalled, confirmed(4));
    expect(revealVisual(resumed)).toEqual({
      beat: "tell",
      class: 4,
      extended: true,
    });
    // …and the outcome survives intact through the unseal to the card.
    const card = revealReducer(revealReducer(resumed, beatElapsed), beatElapsed);
    expect(revealVisual(card)).toEqual({
      beat: "card",
      class: 4,
      entryIndex: fixtureRevealOutcome(4).entryIndex,
      asset: fixtureRevealOutcome(4).asset,
    });
  });
});

describe("revealReducer — beat advancement and exit", () => {
  it("beat_elapsed drives tell → unseal → card with the outcome intact; card never auto-advances", () => {
    const tell = replayReveal([...taps(TAP_COUNT), confirmed(4)]);
    const unseal = revealReducer(tell, beatElapsed);
    const card = revealReducer(unseal, beatElapsed);
    expect(revealVisual(unseal)).toEqual({ beat: "unseal", class: 4 });
    expect(revealVisual(card)).toEqual({
      beat: "card",
      class: 4,
      entryIndex: fixtureRevealOutcome(4).entryIndex,
      asset: fixtureRevealOutcome(4).asset,
    });
    expect(revealReducer(card, beatElapsed)).toBe(card);
  });

  it("dismiss exits card, failed and stalled — and nothing mid-sequence", () => {
    const card = replayReveal([
      ...taps(TAP_COUNT),
      confirmed(1),
      beatElapsed,
      beatElapsed,
    ]);
    expect(revealReducer(card, dismiss).beat).toBe("settled");
    expect(replayReveal([failed, dismiss])).toEqual({
      beat: "settled",
      outcome: null,
    });
    expect(replayReveal([...taps(TAP_COUNT), stallTimeout, dismiss])).toEqual({
      beat: "settled",
      outcome: null,
    });
    for (const mid of [
      INITIAL_REVEAL_STATE,
      replayReveal([tap]),
      replayReveal(taps(TAP_COUNT)),
      replayReveal([...taps(TAP_COUNT), confirmed(2)]),
    ]) {
      expect(revealReducer(mid, dismiss)).toBe(mid);
    }
  });

  it("retry from failed is a clean pre-entry reset, from every failure origin", () => {
    for (const origin of [
      [failed],
      [tap, failed],
      [...taps(TAP_COUNT), failed],
      [...taps(TAP_COUNT), stallTimeout, failed],
    ]) {
      expect(replayReveal([...origin, retry])).toEqual(INITIAL_REVEAL_STATE);
    }
    // retry means nothing anywhere else.
    const strained = replayReveal(taps(TAP_COUNT));
    expect(revealReducer(strained, retry)).toBe(strained);
  });

  it("no reachable state has a field that could imply a spent entry", () => {
    for (const classIndex of CLASSES) {
      for (const { state } of searchReachable(classIndex).nodes) {
        for (const key of Object.keys(state)) {
          expect(key).not.toMatch(/credit|consum|balance|spent/i);
        }
      }
    }
  });
});

describe("revealReducer — totality and determinism", () => {
  it("every (reachable state, event) pair is defined and deterministic", () => {
    for (const classIndex of CLASSES) {
      for (const { state } of searchReachable(classIndex).nodes) {
        for (const event of alphabet(classIndex)) {
          const a = revealReducer(state, event);
          const b = revealReducer(state, event);
          expect(a).toBeDefined();
          expect(b).toEqual(a);
        }
      }
    }
  });

  it("tapCount parameterization holds the invariants at other magnitudes", () => {
    for (const tapCount of [1, 2, 5]) {
      const events: RevealEvent[] = [confirmed(3), ...taps(tapCount)];
      expect(replayReveal(events, tapCount).beat).toBe("tell");
      expect(replayReveal(taps(tapCount), tapCount)).toEqual({
        beat: "strain",
      });
    }
  });
});
