/*
 * The reveal-loop beat machine (10.C Step 2) — a PURE reducer:
 * (state, event) -> state. No timers, no React, no I/O; the takeover
 * component owns every effect (tap capture, the outcome-seam call, the
 * stall timer, beat-duration timers) and feeds the results in as events.
 *
 * Beats (reveal-spec.md §3):
 *   entry -> revealing(tapsSoFar) -> strain -> tell -> unseal -> card ->
 *   settled, plus failed (3f) and stalled (the PRD D-03 come-back state).
 *
 * Invariants this machine enforces (each pinned in machine.test.ts):
 *
 *  - CONFIRMED-BEFORE-REVEAL, by type: tell/unseal/card hold a
 *    `ConfirmedOutcome`, a branded type only ever constructed inside this
 *    module's `tx_confirmed` case. No reachable state carries class data
 *    before a `tx_confirmed` event has been consumed.
 *  - HELD CONFIRMATION: a confirmation landing during entry/revealing is
 *    RECORDED, not applied — the machine stays put until the final tap,
 *    then resolves straight to the tell ("if confirmation already landed,
 *    the beat resolves instantly", spec §3 Beat 3 — strain is passed
 *    through, never rendered).
 *  - NG-007: extra taps are no-ops; nothing about tap timing, count past
 *    the final reveal, or rhythm can influence state. Class influences state
 *    from the tell ONWARD only — the visual projection (`revealVisual`)
 *    for every pre-tell beat has no class field AT THE TYPE LEVEL.
 *  - STALL ≠ FAILURE: `stalled` is reachable only from `strain` via
 *    `stall_timeout` (genuine stall); `failed` only via `tx_failed`.
 *    Distinct states, distinct copy (copy.ts), never conflated.
 *
 * The reducer is TOTAL — every (state, event) pair is defined, and events
 * that don't apply are no-ops (the same state object is returned). This
 * deliberately diverges from `lib/tx/lifecycle.ts`'s throwing reducer: the
 * trade machine is driven by one sequential executor, where an illegal
 * event is a driver bug; the reveal machine is fed by racing async sources
 * (user taps, the tx watcher, a stall timer, beat timers), where a stale
 * event — a stall timer firing just after confirmation, a duplicate
 * watcher callback — is structural, not a bug. Crashing the takeover over
 * a benign race would violate "never a dead end".
 *
 * Event-name note: the step spec names events TAP / TX_CONFIRMED /
 * TX_FAILED / STALL_TIMEOUT / DISMISS / RETRY; kinds here are lower-case
 * to match the repo's reducer idiom (`lib/tx/lifecycle.ts`). One event is
 * ADDED beyond that alphabet: `beat_elapsed`, the timer-driven advance for
 * the fixed-duration beats (tell -> unseal -> card). A timerless reducer
 * cannot advance them otherwise; the component dispatches it when the
 * beat's named duration (constants.ts) elapses.
 */

import { entryRecorded, landingUnresolved } from "@/tx/errors";
import type { TxFailure } from "@/tx/types";
import { EXTENDED_TELL_MIN_CLASS, TAP_COUNT } from "./constants";
import type { RevealOutcome, RevealClass } from "./types";

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
  /** Beat 1 — takeover mounted, pass idle, awaiting the first tap. */
  | { beat: "entry"; confirmed: ConfirmedOutcome | null }
  /** Beat 2 — tap-driven reveal progression, 1 ≤ tapsSoFar < tapCount. */
  | { beat: "revealing"; tapsSoFar: number; confirmed: ConfirmedOutcome | null }
  /** Beat 3 — fully revealed, confirmation not yet landed. Unbounded hold. */
  | { beat: "strain" }
  /** Beat 3f — tx failure. Credit untouched; retry present. */
  | { beat: "failed"; failure: TxFailure }
  /** D-03 come-back state — genuine stall only, never failure. */
  | { beat: "stalled" }
  /** Beat 4 — the violet → class-colour tell. */
  | { beat: "tell"; outcome: ConfirmedOutcome }
  /** Beat 5 — shell burst + bounded class flash. */
  | { beat: "unseal"; outcome: ConfirmedOutcome }
  /** Beat 6 — the card, centred, awaiting the explicit dismiss. */
  | { beat: "card"; outcome: ConfirmedOutcome }
  /** Beat 7 — exit: control returns to the surface behind the takeover.
   *  `outcome` is set only when the CARD was dismissed; `failure` only when the
   *  FAILED beat was; a dismiss from stalled carries neither (the transaction
   *  may still land). The host reads `revealVisual(...).exit` from these —
   *  audit O25 (2026-09-11): a dismissed failure used to look exactly like a
   *  dismissed card, and the page behind rendered "Sealed" for both. */
  | { beat: "settled"; outcome: ConfirmedOutcome | null; failure: TxFailure | null };

export type RevealEvent =
  | { kind: "tap" }
  | { kind: "tx_confirmed"; outcome: RevealOutcome }
  | { kind: "tx_failed"; failure: TxFailure }
  | { kind: "stall_timeout" }
  | { kind: "beat_elapsed" }
  | { kind: "dismiss" }
  | { kind: "retry" };

export const INITIAL_REVEAL_STATE: RevealState = {
  beat: "entry",
  confirmed: null,
};

/**
 * Advance the machine. Total: unlisted (state, event) pairs return `state`
 * unchanged (see the header for why no-op beats throwing here).
 *
 * `tapCount` is parameterized (defaulting to the Q-026 constant) so
 * property tests can exercise other magnitudes without editing canon.
 */
export function revealReducer(
  state: RevealState,
  event: RevealEvent,
  tapCount: number = TAP_COUNT,
): RevealState {
  switch (event.kind) {
    case "tap": {
      // NG-007: taps only matter during the reveal progression. Everywhere
      // else — including strain and every post-confirmation beat — extra
      // tapping changes NOTHING.
      if (state.beat === "entry" || state.beat === "revealing") {
        const taps = (state.beat === "revealing" ? state.tapsSoFar : 0) + 1;
        if (taps < tapCount) {
          return { beat: "revealing", tapsSoFar: taps, confirmed: state.confirmed };
        }
        // Final tap: a held confirmation resolves the strain beat
        // instantly (pass-through); otherwise the pass strains.
        return state.confirmed !== null
          ? { beat: "tell", outcome: state.confirmed }
          : { beat: "strain" };
      }
      return state;
    }

    case "tx_confirmed": {
      // The ONLY site that mints a ConfirmedOutcome.
      const outcome = event.outcome as ConfirmedOutcome;
      if (state.beat === "entry" || state.beat === "revealing") {
        // Held, not applied — first confirmation wins, duplicates ignored.
        if (state.confirmed !== null) return state;
        return { ...state, confirmed: outcome };
      }
      if (state.beat === "strain") return { beat: "tell", outcome };
      if (state.beat === "stalled") {
        // Late confirmation while the come-back state is still on screen:
        // RESUME the reveal — never restart, never drop the outcome.
        // Leaving the user on "come back later" when the chain has
        // answered would be a dishonest state. Founder-RATIFIED
        // 2026-08-11 (10.C Step 5a); pinned in machine.test.ts.
        return { beat: "tell", outcome };
      }
      // Post-reveal / post-failure duplicates from the watcher: stale.
      return state;
    }

    case "tx_failed": {
      // A failure can land in any pre-confirmation beat — including entry
      // (the tx is in flight before the first tap) and stalled (the
      // stalled tx eventually resolving as failed while the user is still
      // looking). Swallowing any of those would be a dead end.
      if (
        (state.beat === "entry" || state.beat === "revealing") &&
        state.confirmed === null
      ) {
        return { beat: "failed", failure: event.failure };
      }
      if (state.beat === "strain" || state.beat === "stalled") {
        return { beat: "failed", failure: event.failure };
      }
      // Held/applied confirmation present, or already failed: stale event.
      return state;
    }

    case "stall_timeout":
      // ONLY strain can stall — a timer firing after the machine moved on
      // (confirmation raced it) is the benign race the no-op design is for.
      return state.beat === "strain" ? { beat: "stalled" } : state;

    case "beat_elapsed":
      // Timer-driven advance for the fixed-duration beats only. The card
      // does NOT auto-advance: leaving is the user's explicit dismiss.
      if (state.beat === "tell") return { beat: "unseal", outcome: state.outcome };
      if (state.beat === "unseal") return { beat: "card", outcome: state.outcome };
      return state;

    case "dismiss":
      // The single explicit exit (Beat 7), plus the honest exits from the
      // failure and come-back states. No dismiss exists mid-sequence.
      if (state.beat === "card") {
        return { beat: "settled", outcome: state.outcome, failure: null };
      }
      if (state.beat === "failed") {
        return { beat: "settled", outcome: null, failure: state.failure };
      }
      if (state.beat === "stalled") return { beat: "settled", outcome: null, failure: null };
      return state;

    case "retry":
      // 3f retry: back to a clean pre-entry state — indistinguishable from
      // a fresh takeover, nothing carried over, credit untouched (the
      // machine holds no credit field at all; whole-key assertions pin that
      // in machine.test.ts).
      return state.beat === "failed" ? INITIAL_REVEAL_STATE : state;
  }
}

/**
 * The visual projection — EVERYTHING the takeover is allowed to render
 * from. This type is the NG-007 / confirmed-before-reveal guard made
 * structural: pre-tell variants carry NO class field, so a component
 * rendering from `RevealVisual` cannot leak class before the tell even by
 * accident. A held-but-unapplied confirmation is invisible here.
 */
export type RevealVisual =
  | { beat: "entry" }
  | { beat: "revealing"; tapsSoFar: number }
  | { beat: "strain" }
  | { beat: "failed"; failure: TxFailure }
  | { beat: "stalled" }
  | { beat: "tell"; class: RevealClass; extended: boolean }
  | { beat: "unseal"; class: RevealClass }
  | { beat: "card"; class: RevealClass; entryIndex: number; asset: string }
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
    case "revealing":
      return { beat: "revealing", tapsSoFar: state.tapsSoFar };
    case "strain":
      return { beat: "strain" };
    case "failed":
      return { beat: "failed", failure: state.failure };
    case "stalled":
      return { beat: "stalled" };
    case "tell":
      return {
        beat: "tell",
        class: state.outcome.class,
        extended: state.outcome.class >= EXTENDED_TELL_MIN_CLASS,
      };
    case "unseal":
      return { beat: "unseal", class: state.outcome.class };
    case "card":
      return {
        beat: "card",
        class: state.outcome.class,
        entryIndex: state.outcome.entryIndex,
        asset: state.outcome.asset,
      };
    case "settled":
      return { beat: "settled", exit: settledExit(state) };
  }
}

/** Fold an event sequence from the initial state — shared by the tests
 * and the dev lever (which reaches states by REPLAY, never by minting a
 * `ConfirmedOutcome` outside the reducer). */
export function replayReveal(
  events: readonly RevealEvent[],
  tapCount: number = TAP_COUNT,
): RevealState {
  let state = INITIAL_REVEAL_STATE;
  for (const event of events) state = revealReducer(state, event, tapCount);
  return state;
}
