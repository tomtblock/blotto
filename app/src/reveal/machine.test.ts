/*
 * Entry-outcome beat-machine guards — same rigour as a pure-reducer suite.
 *
 * REWRITTEN IN PLACE, 2026-09-15 (standing rule 0.7: a test that encodes a
 * replaced rule is rewritten citing the instruction, never deleted). The
 * founder's instruction of 2026-09-14 removed the reveal — no egg, no taps,
 * no tell, no unseal — so the tap-driven cases below became cases about the
 * one transition that replaced them, confirmation -> card. What each group
 * used to pin, and what it pins now:
 *
 *  - NG-007 ("class influences NOTHING before the tell") is now stronger and
 *    simpler: NO visual variant carries a class field at all. The drawn
 *    class is not shown in the entry flow.
 *  - Confirmed-before-reveal is confirmed-before-CARD: exhaustive
 *    reachability over the full event alphabet — no state reachable without
 *    a `tx_confirmed` event carries outcome data, and `card` is unreachable
 *    outright.
 *  - Stall ≠ failure: `stalled` enters ONLY via (entry, stall_timeout) — the
 *    timer moved from the old strain beat to the waiting beat; `failed` ONLY
 *    via `tx_failed`.
 *  - Resume-from-stalled is RATIFIED canon (founder, 2026-08-11 — 10.C
 *    Step 5a) and holds without a reveal: a confirmation landing on the
 *    come-back screen shows the card; never a restart, never a dropped
 *    outcome.
 *  - Retry from failed is a clean pre-entry reset with no state field that
 *    could imply a spent entry.
 *
 * Gone with the taps, not rewritten, because their subject no longer
 * exists: the held-confirmation pass-through, the extended tell, the
 * `beat_elapsed` advance, and the `tapCount` parameterisation. The change
 * doc (`docs/architecture/DECISIONS.md`) names them.
 */

import { describe, expect, it } from "vitest";
import type { TxFailure } from "@/tx/types";
import { FAILURE_COPY } from "@/tx/errors";
import {
  INITIAL_REVEAL_STATE,
  replayReveal,
  revealReducer,
  revealVisual,
  type RevealEvent,
  type RevealState,
} from "./machine";
import { fixtureRevealOutcome } from "./fixtures";
import type { RevealClass } from "./types";

const CLASSES: RevealClass[] = [0, 1, 2, 3, 4];

const FAILURE: TxFailure = {
  kind: "rpc-failure",
  message: "test failure",
  detail: "machine.test fixture",
  broadcast: true,
  retryable: true,
};

const confirmed = (classIndex: RevealClass): RevealEvent => ({
  kind: "tx_confirmed",
  outcome: fixtureRevealOutcome(classIndex),
});
const failed: RevealEvent = { kind: "tx_failed", failure: FAILURE };
const stallTimeout: RevealEvent = { kind: "stall_timeout" };
const dismiss: RevealEvent = { kind: "dismiss" };
const retry: RevealEvent = { kind: "retry" };

/** The bounded event alphabet the exhaustive searches range over. */
const alphabet = (classIndex: RevealClass): RevealEvent[] => [
  confirmed(classIndex),
  failed,
  stallTimeout,
  dismiss,
  retry,
];

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

describe("revealReducer — the drawn class is shown nowhere in the entry flow (founder 2026-09-14)", () => {
  // Rewritten from "class is invisible through the last pre-tell beat":
  // there is no tell, so the projection is class-free in EVERY beat.
  it("no visual variant carries a class field — the card included", () => {
    for (const classIndex of CLASSES) {
      for (const { state } of searchReachable(classIndex).nodes) {
        const visual = revealVisual(state);
        expect("class" in visual, `${visual.beat} exposed a class`).toBe(false);
      }
    }
  });

  it("the card projection is identical across all classes but for nothing at all", () => {
    // The seat and the asset are fixture-fixed, so five classes must project
    // to five deep-equal cards: the class is held in state, never rendered.
    const cards = CLASSES.map((classIndex) => revealVisual(replayReveal([confirmed(classIndex)])));
    for (const card of cards) expect(card).toEqual(cards[0]);
  });
});

describe("revealReducer — confirmed-before-card (exhaustive search)", () => {
  it("no state reachable without tx_confirmed carries outcome data, and the card is unreachable", () => {
    for (const classIndex of CLASSES) {
      for (const { state, sawConfirmed } of searchReachable(classIndex).nodes) {
        if (!sawConfirmed) {
          expect(
            carriesClassData(state),
            `outcome data before confirmation: ${JSON.stringify(state)}`,
          ).toBe(false);
          expect(state.beat).not.toBe("card");
        }
      }
    }
  });

  // Rewritten from "held confirmation is recorded, not applied — revealing
  // continues" (founder 2026-09-14): with no reveal to finish, confirmation
  // is applied at once.
  it("confirmation goes straight to the card — there is nothing to tap first", () => {
    const state = replayReveal([confirmed(3)]);
    expect(state.beat).toBe("card");
    expect(revealVisual(state)).toEqual({
      beat: "card",
      entryIndex: fixtureRevealOutcome(3).entryIndex,
      asset: fixtureRevealOutcome(3).asset,
    });
  });

  it("first confirmation wins — a duplicate never rewrites the outcome", () => {
    const state = replayReveal([confirmed(4), confirmed(0)]);
    expect(state.beat).toBe("card");
    if (state.beat === "card") expect(state.outcome.class).toBe(4);
  });
});

describe("revealReducer — stall vs failure are distinct and separately gated", () => {
  // Rewritten from "(strain, stall_timeout)" (founder 2026-09-14): the
  // strain beat was "fully revealed, confirmation not yet landed"; with
  // nothing to reveal, waiting is the entry beat and the timer moved there.
  it("stalled enters ONLY via (entry, stall_timeout); failed ONLY via tx_failed", () => {
    for (const classIndex of CLASSES) {
      for (const { from, event, to } of searchReachable(classIndex).transitions) {
        if (to.beat === "stalled") {
          expect(from.beat).toBe("entry");
          expect(event.kind).toBe("stall_timeout");
        }
        if (to.beat === "failed") {
          expect(event.kind).toBe("tx_failed");
        }
      }
    }
  });

  it("a stall timer racing past confirmation is a harmless no-op", () => {
    const card = replayReveal([confirmed(2)]);
    expect(revealReducer(card, stallTimeout)).toBe(card);
  });

  it("failure is reachable from entry AND stalled — never after confirmation", () => {
    expect(replayReveal([failed]).beat).toBe("failed");
    expect(replayReveal([stallTimeout, failed]).beat).toBe("failed");
    // The card ignores a stale failure outright.
    const card = replayReveal([confirmed(3)]);
    expect(revealReducer(card, failed)).toBe(card);
  });

  it("late confirmation while stalled RESUMES to the card — never restarts, never drops the outcome (founder-RATIFIED 2026-08-11)", () => {
    const stalled = replayReveal([stallTimeout]);
    expect(stalled).toEqual({ beat: "stalled" });
    const resumed = revealReducer(stalled, confirmed(4));
    expect(revealVisual(resumed)).toEqual({
      beat: "card",
      entryIndex: fixtureRevealOutcome(4).entryIndex,
      asset: fixtureRevealOutcome(4).asset,
    });
  });
});

describe("revealReducer — exit", () => {
  it("the card never auto-advances; only the explicit dismiss leaves it", () => {
    const card = replayReveal([confirmed(4)]);
    for (const event of [stallTimeout, retry, confirmed(1)]) {
      expect(revealReducer(card, event)).toBe(card);
    }
    expect(revealReducer(card, dismiss).beat).toBe("settled");
  });

  it("dismiss exits card, failed and stalled — and never the waiting beat", () => {
    expect(revealReducer(replayReveal([confirmed(1)]), dismiss)).toEqual({
      beat: "settled",
      outcome: fixtureRevealOutcome(1),
      failure: null,
    });
    // A dismissed failure keeps the failure; a dismissed stall keeps nothing
    // (the transaction may still land). The exit projection reads these.
    expect(replayReveal([failed, dismiss])).toEqual({
      beat: "settled",
      outcome: null,
      failure: FAILURE,
    });
    expect(replayReveal([stallTimeout, dismiss])).toEqual({
      beat: "settled",
      outcome: null,
      failure: null,
    });
    // Waiting has no dismiss: the stall timer is what keeps it from being a
    // dead end, and a Back button here would invite a second entry.
    expect(revealReducer(INITIAL_REVEAL_STATE, dismiss)).toBe(INITIAL_REVEAL_STATE);
  });

  it("retry from failed is a clean pre-entry reset, from every failure origin", () => {
    for (const origin of [[failed], [stallTimeout, failed]]) {
      expect(replayReveal([...origin, retry])).toEqual(INITIAL_REVEAL_STATE);
    }
    // retry means nothing anywhere else.
    for (const elsewhere of [INITIAL_REVEAL_STATE, replayReveal([stallTimeout]), replayReveal([confirmed(0)])]) {
      expect(revealReducer(elsewhere, retry)).toBe(elsewhere);
    }
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
});

/*
 * Audit O25 (2026-09-11): the settled beat used to project to a bare
 * `{ beat: "settled" }` whatever it was left from, and the page behind
 * rendered "Your seven battles are sealed" for a dismissed FAILURE exactly as
 * for a dismissed card. The exit is now part of the projection and pinned
 * here per failure kind, so a kind added later has to declare which way it
 * leaves. Unchanged in substance by the 2026-09-14 instruction; only the
 * tap prefixes went, so "from every failure origin" now means from the
 * waiting beat and from the come-back state.
 */
describe("revealVisual — the exit the settled beat reports (audit O25)", () => {
  const failedWith = (kind: TxFailure["kind"]): RevealEvent => ({
    kind: "tx_failed",
    failure: { ...FAILURE, kind },
  });
  const exitAfter = (events: RevealEvent[]) => {
    const visual = revealVisual(replayReveal(events));
    expect(visual.beat).toBe("settled");
    return visual.beat === "settled" ? visual.exit : null;
  };

  it("a dismissed card is 'entered'", () => {
    expect(exitAfter([confirmed(3), dismiss])).toBe("entered");
  });

  it("a dismissed failure that landed nothing is 'not-entered' — never 'Sealed'", () => {
    for (const kind of [
      "user-rejected",
      "insufficient-sol",
      "blockhash-expired",
      "program-rejected",
      "entries-paused",
      "pool-full",
      "deadline-passed",
      "pool-closed",
      "packet-stale",
      "rpc-failure",
    ] as const) {
      expect(exitAfter([failedWith(kind), dismiss]), kind).toBe("not-entered");
      // …from every failure origin, not only the waiting one.
      expect(exitAfter([stallTimeout, failedWith(kind), dismiss]), kind).toBe("not-entered");
    }
  });

  it("a dismissed failure whose entry IS on-chain is 'entered' — the seat is held", () => {
    for (const kind of ["outcome-unreadable", "outcome-mismatch", "already-entered"] as const) {
      expect(exitAfter([failedWith(kind), dismiss]), kind).toBe("entered");
    }
  });

  it("a dismissed stall is 'pending' — the transaction may still land", () => {
    expect(exitAfter([stallTimeout, dismiss])).toBe("pending");
  });

  /*
   * Audit 2026-09-11 (C-14). `executeTrade` gives up waiting after its
   * confirmation timeout and reports a BROADCAST failure it could not
   * resolve — the transaction may still land. The exit used to ignore the
   * flag and answer "not-entered", which restarts the flow and invites a
   * second entry into a seat the player may already hold.
   */
  it("a dismissed broadcast-but-unresolved failure is 'pending', not 'not-entered'", () => {
    const unresolved: RevealEvent = {
      kind: "tx_failed",
      failure: {
        ...FAILURE,
        kind: "rpc-failure",
        broadcast: true,
        // executeTrade's own words: status unknown, so a retry could enter twice.
        retryable: false,
      },
    };
    expect(exitAfter([unresolved, dismiss])).toBe("pending");
    expect(exitAfter([stallTimeout, unresolved, dismiss])).toBe("pending");
  });

  it("a broadcast failure the CHAIN answered is still 'not-entered'", () => {
    // The distinction the exit has to keep: broadcast is not the test —
    // "did anything land, and can anything still land" is. A pool that
    // filled between simulation and inclusion refused definitively.
    for (const kind of ["pool-full", "entries-paused", "deadline-passed", "pool-closed"] as const) {
      expect(
        exitAfter([
          { kind: "tx_failed", failure: { ...FAILURE, kind, broadcast: true, retryable: false } },
          dismiss,
        ]),
        kind,
      ).toBe("not-entered");
    }
    // And a broadcast rpc-failure the chain DID report is a verdict too.
    expect(
      exitAfter([
        {
          kind: "tx_failed",
          failure: { ...FAILURE, kind: "rpc-failure", broadcast: true, retryable: true },
        },
        dismiss,
      ]),
    ).toBe("not-entered");
  });

  it("every failure kind has a declared exit (a new kind cannot fall through silently)", () => {
    /*
     * Read from FAILURE_COPY, which the compiler requires to be exhaustive
     * over TxFailureKind. The hand-written list this replaces could not
     * keep the promise in its own name: a kind added to the union and to
     * the copy record was simply absent here, and "entry-refused" (audit
     * D-12) was added without this test noticing.
     */
    const kinds = Object.keys(FAILURE_COPY) as TxFailure["kind"][];
    expect(kinds.length).toBeGreaterThan(12);
    for (const kind of kinds) {
      expect(["entered", "not-entered", "pending"], kind).toContain(
        exitAfter([failedWith(kind), dismiss]),
      );
    }
  });

  it("a declined entry leaves as 'not-entered' — the service refused before signing", () => {
    // D-12: nothing was signed and nothing was charged, so the honest exit
    // is the start of the flow, not the sealed panel and not the pool page.
    expect(exitAfter([failedWith("entry-refused"), dismiss])).toBe("not-entered");
  });
});
