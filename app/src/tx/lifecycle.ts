/*
 * Pure §5 lifecycle state machine: quote → submitting → pending →
 * confirmed / failed (frontend PRD §5; roadmap 10.B "transaction lifecycle
 * states"). Kept free of RPC and React so every transition is unit-testable
 * offline. `executeTrade` (execute.ts) drives it; the dev page renders its
 * emitted log entries.
 *
 * Legality rules encoded here:
 *  - a trade arms in "quote" and can only start submitting from there;
 *  - "pending" strictly requires a broadcast signature (submitting first);
 *  - "confirmed" strictly requires "pending" — a confirmation can never
 *    appear for something that was not broadcast (the NG-007-adjacent
 *    invariant: no outcome before the chain has spoken);
 *  - "failed" is legal from "submitting" (sign/preflight failures, nothing
 *    sent) and from "pending" (on-chain failure or lapse after broadcast);
 *  - terminal states only exit via "reset" back to "quote".
 */

import type { TradePhase, TxFailure } from "./types";

export type TradeEvent =
  | { kind: "reset" }
  | { kind: "submit" }
  | { kind: "broadcast"; signature: string }
  | { kind: "confirm" }
  | { kind: "fail"; failure: TxFailure };

export interface TradeState {
  phase: TradePhase;
  /** Set from "broadcast" onward; survives into confirmed/failed. */
  signature: string | null;
  /** Set only in "failed". */
  failure: TxFailure | null;
}

export const INITIAL_TRADE_STATE: TradeState = {
  phase: "quote",
  signature: null,
  failure: null,
};

export class IllegalTransitionError extends Error {
  constructor(phase: TradePhase, event: TradeEvent["kind"]) {
    super(`illegal lifecycle transition: "${event}" while in phase "${phase}"`);
  }
}

/**
 * Advance the state machine. Throws `IllegalTransitionError` on any
 * transition the §5 machine does not define — a thrown transition is a bug
 * in the driver, never a user-visible state.
 */
export function tradeReducer(state: TradeState, event: TradeEvent): TradeState {
  const { phase } = state;
  switch (event.kind) {
    case "reset":
      return INITIAL_TRADE_STATE;
    case "submit":
      if (phase !== "quote") throw new IllegalTransitionError(phase, event.kind);
      return { phase: "submitting", signature: null, failure: null };
    case "broadcast":
      if (phase !== "submitting") {
        throw new IllegalTransitionError(phase, event.kind);
      }
      return { phase: "pending", signature: event.signature, failure: null };
    case "confirm":
      if (phase !== "pending") throw new IllegalTransitionError(phase, event.kind);
      return { phase: "confirmed", signature: state.signature, failure: null };
    case "fail":
      if (phase !== "submitting" && phase !== "pending") {
        throw new IllegalTransitionError(phase, event.kind);
      }
      // A failure before broadcast must not claim a signature was sent.
      if (phase === "submitting" && event.failure.broadcast) {
        throw new IllegalTransitionError(phase, event.kind);
      }
      return {
        phase: "failed",
        signature: state.signature,
        failure: event.failure,
      };
  }
}
