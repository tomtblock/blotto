/*
 * The entry-outcome beat machine — a PURE reducer: (state, event) -> state.
 * No timers, no React, no I/O; the host component owns every effect (the
 * outcome-seam call, the stall timer) and feeds the results in as events.
 *
 * WHAT THIS WAS, AND WHAT CHANGED. Until 2026-09-15 this machine drove a
 * REVEAL: the player tapped an egg, it hatched, and the drawn character
 * class was told and unsealed before the card (beats entry -> revealing ->
 * strain -> tell -> unseal -> card). The founder's instruction of
 * 2026-09-14 — "the rarity assignment will happen quietly under the hood
 * and will not be something initially broadcast to users" — removes the
 * theatre: no egg, no taps, no tell, no unseal. The beats that remain are
 * the ones that were never about the egg, and they keep their proven
 * behaviour:
 *
 *   entry -> card -> settled, plus failed (the honest failure state) and
 *   stalled (the PRD D-03 come-back state).
 *
 * Invariants this machine enforces (each pinned in machine.test.ts):
 *
 *  - CONFIRMED-BEFORE-CARD, by type: `card` holds a `ConfirmedOutcome`, a
 *    branded type only ever constructed inside this module's `tx_confirmed`
 *    case. No reachable state carries outcome data before a `tx_confirmed`
 *    event has been consumed.
 *  - STALL ≠ FAILURE: `stalled` is reachable only from `entry` via
 *    `stall_timeout` (a genuine stall — the timer moved here from the old
 *    strain beat, which was "fully revealed, confirmation not yet landed";
 *    with nothing to reveal, waiting IS the entry beat); `failed` only via
 *    `tx_failed`. Distinct states, distinct copy, never conflated.
 *  - RESUME FROM STALLED (founder-RATIFIED 2026-08-11, 10.C Step 5a): a
 *    confirmation landing while the come-back state is on screen shows the
 *    card — never a restart, never a dropped outcome. The ruling was made
 *    for the reveal and holds without one: leaving the player on "come back
 *    later" when the chain has answered would be a dishonest state.
 *  - THE CARD CARRIES NO CLASS. `RevealOutcome.class` still arrives from
 *    the chain (the draw happens, and is replayable from published events)
 *    and the state still holds it, but the visual projection of the card
 *    does not expose it: the share card shows the pool and the seat, and
 *    the one surface that shows rarity is the profile
 *    (`COPY.profile.rarityCaveat` sits beside it there).
 *
 * The reducer is TOTAL — every (state, event) pair is defined, and events
 * that don't apply are no-ops (the same state object is returned). This
 * deliberately diverges from `lib/tx/lifecycle.ts`'s throwing reducer: the
 * trade machine is driven by one sequential executor, where an illegal
 * event is a driver bug; this machine is fed by racing async sources (the
 * tx watcher, a stall timer), where a stale event — a stall timer firing
 * just after confirmation, a duplicate watcher callback — is structural,
 * not a bug. Crashing the takeover over a benign race would violate
 * "never a dead end".
 */

import { entryRecorded, landingUnresolved } from "@/tx/errors";
import type { TxFailure } from "@/tx/types";
import type { RevealOutcome } from "./types";

declare const CONFIRMED: unique symbol;

/**
 * An outcome that has passed through `tx_confirmed`. The brand has no
 * runtime cost and cannot be named outside this module — the single cast
 * in the `tx_confirmed` case below is the only way one comes to exist, so
 * a state type requiring `ConfirmedOutcome` is unreachable before
 * confirmation by construction.
 */
export type ConfirmedOutcome = RevealOutcome & {
  readonly [CONFIRMED]: true;
};

export type RevealState =
  /** Waiting: the entry is submitted and the chain has not yet answered. */
  | { beat: "entry" }
  /** Tx failure. Credit untouched; retry present when the failure allows it. */
  | { beat: "failed"; failure: TxFailure }
  /** D-03 come-back state — genuine stall only, never failure. */
  | { beat: "stalled" }
  /** The card, centred, awaiting the explicit dismiss. */
  | { beat: "card"; outcome: ConfirmedOutcome }
  /** Exit: control returns to the surface behind the takeover.
   *  `outcome` is set only when the CARD was dismissed; `failure` only when the
   *  FAILED beat was; a dismiss from stalled carries neither (the transaction
   *  may still land). The host reads `revealVisual(...).exit` from these —
   *  audit O25 (2026-09-11): a dismissed failure used to look exactly like a
   *  dismissed card, and the page behind rendered "Sealed" for both. */
  | { beat: "settled"; outcome: ConfirmedOutcome | null; failure: TxFailure | null };

export type RevealEvent =
  | { kind: "tx_confirmed"; outcome: RevealOutcome }
  | { kind: "tx_failed"; failure: TxFailure }
  | { kind: "stall_timeout" }
  | { kind: "dismiss" }
  | { kind: "retry" };

export const INITIAL_REVEAL_STATE: RevealState = { beat: "entry" };

/**
 * Advance the machine. Total: unlisted (state, event) pairs return `state`
 * unchanged (see the header for why no-op beats throwing here).
 */
export function revealReducer(state: RevealState, event: RevealEvent): RevealState {
  switch (event.kind) {
    case "tx_confirmed": {
      // The ONLY site that mints a ConfirmedOutcome.
      const outcome = event.outcome as ConfirmedOutcome;
      // Straight to the card — there is nothing to reveal first. A first
      // confirmation wins: once on the card, a duplicate from the watcher
      // is stale and changes nothing.
      if (state.beat === "entry") return { beat: "card", outcome };
      if (state.beat === "stalled") {
        // Late confirmation while the come-back state is still on screen:
        // RESUME — never restart, never drop the outcome. Founder-RATIFIED
        // 2026-08-11 (10.C Step 5a); pinned in machine.test.ts.
        return { beat: "card", outcome };
      }
      // Post-card / post-failure duplicates from the watcher: stale.
      return state;
    }

    case "tx_failed":
      // A failure can land while waiting, or while the stalled tx eventually
      // resolves as failed with the come-back state still on screen.
      // Swallowing either would be a dead end.
      if (state.beat === "entry" || state.beat === "stalled") {
        return { beat: "failed", failure: event.failure };
      }
      // Confirmation already applied, or already failed: stale event.
      return state;

    case "stall_timeout":
      // ONLY the waiting beat can stall — a timer firing after the machine
      // moved on (confirmation raced it) is the benign race the no-op
      // design is for.
      return state.beat === "entry" ? { beat: "stalled" } : state;

    case "dismiss":
      // The single explicit exit from the card, plus the honest exits from
      // the failure and come-back states. No dismiss exists while waiting:
      // the stall timer is what guarantees the wait cannot be a dead end.
      if (state.beat === "card") {
        return { beat: "settled", outcome: state.outcome, failure: null };
      }
      if (state.beat === "failed") {
        return { beat: "settled", outcome: null, failure: state.failure };
      }
      if (state.beat === "stalled") return { beat: "settled", outcome: null, failure: null };
      return state;

    case "retry":
      // Retry: back to a clean waiting state — indistinguishable from a
      // fresh takeover, nothing carried over, credit untouched (the machine
      // holds no credit field at all; whole-key assertions pin that in
      // machine.test.ts).
      return state.beat === "failed" ? INITIAL_REVEAL_STATE : state;
  }
}

/**
 * The visual projection — EVERYTHING the takeover is allowed to render
 * from. No variant carries a class field: the drawn class is not shown
 * anywhere in the entry flow (founder instruction 2026-09-14), so a
 * component rendering from `RevealVisual` cannot show it even by accident.
 */
export type RevealVisual =
  | { beat: "entry" }
  | { beat: "failed"; failure: TxFailure }
  | { beat: "stalled" }
  | { beat: "card"; entryIndex: number; asset: string }
  | { beat: "settled"; exit: RevealExit };

/**
 * What the settled beat hands back to the surface behind the takeover
 * (audit O25). Three answers, because the page behind has three honest
 * responses and used to have one:
 *
 *   - `entered`: the player holds a seat — the card was dismissed, or the
 *     failure was one where the entry IS on-chain (`entryRecorded`). The
 *     sealed panel is the truth.
 *   - `not-entered`: nothing landed and nothing can — back to the start,
 *     never to "Sealed".
 *   - `pending`: left from the come-back state; the transaction was
 *     broadcast and may still land, so neither a second run nor "Sealed"
 *     is honest — the pool page is.
 */
export type RevealExit = "entered" | "not-entered" | "pending";

export function settledExit(state: Extract<RevealState, { beat: "settled" }>): RevealExit {
  if (state.outcome !== null) return "entered";
  if (state.failure === null) return "pending";
  if (entryRecorded(state.failure)) return "entered";
  /*
   * Audit 2026-09-11 (C-14). A transaction that was broadcast and never
   * resolved may STILL LAND, and this function used to answer "not-entered"
   * for it — which sends the player back to the start of the flow and
   * invites a second entry for a seat they may already hold. The failure
   * carries the flag that says so; read it. Same answer as a dismissed
   * stall, for the same reason: neither a second run nor "Sealed" is
   * honest, and the pool page is.
   */
  if (landingUnresolved(state.failure)) return "pending";
  return "not-entered";
}

export function revealVisual(state: RevealState): RevealVisual {
  switch (state.beat) {
    case "entry":
      return { beat: "entry" };
    case "failed":
      return { beat: "failed", failure: state.failure };
    case "stalled":
      return { beat: "stalled" };
    case "card":
      return {
        beat: "card",
        entryIndex: state.outcome.entryIndex,
        asset: state.outcome.asset,
      };
    case "settled":
      return { beat: "settled", exit: settledExit(state) };
  }
}

/** Fold an event sequence from the initial state — shared by the tests
 * and any dev lever (which reaches states by REPLAY, never by minting a
 * `ConfirmedOutcome` outside the reducer). */
export function replayReveal(events: readonly RevealEvent[]): RevealState {
  let state = INITIAL_REVEAL_STATE;
  for (const event of events) state = revealReducer(state, event);
  return state;
}
