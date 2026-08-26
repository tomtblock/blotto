import { describe, expect, it } from "vitest";
import {
  INITIAL_TRADE_STATE,
  IllegalTransitionError,
  tradeReducer,
  type TradeEvent,
  type TradeState,
} from "./lifecycle";
import { makeFailure } from "./errors";

/*
 * Every legal §5 transition and every illegal one, offline. The reducer is
 * the contract the real trade UI (Steps 3/4) will drive; a hole here is a
 * hole in the confirmed-before-reveal discipline.
 */

const failureNotBroadcast = makeFailure("user-rejected", "test", false);
const failureBroadcast = makeFailure("program-rejected", "test", true);

function advance(events: TradeEvent[]): TradeState {
  return events.reduce(tradeReducer, INITIAL_TRADE_STATE);
}

describe("tradeReducer — legal paths", () => {
  it("runs the happy path quote → submitting → pending → confirmed", () => {
    let s = tradeReducer(INITIAL_TRADE_STATE, { kind: "submit" });
    expect(s.phase).toBe("submitting");
    s = tradeReducer(s, { kind: "broadcast", signature: "sig1" });
    expect(s).toMatchObject({ phase: "pending", signature: "sig1" });
    s = tradeReducer(s, { kind: "confirm" });
    expect(s).toMatchObject({ phase: "confirmed", signature: "sig1" });
  });

  it("fails from submitting with a non-broadcast failure", () => {
    const s = advance([
      { kind: "submit" },
      { kind: "fail", failure: failureNotBroadcast },
    ]);
    expect(s).toMatchObject({
      phase: "failed",
      signature: null,
      failure: failureNotBroadcast,
    });
  });

  it("fails from pending, keeping the broadcast signature", () => {
    const s = advance([
      { kind: "submit" },
      { kind: "broadcast", signature: "sig2" },
      { kind: "fail", failure: failureBroadcast },
    ]);
    expect(s).toMatchObject({
      phase: "failed",
      signature: "sig2",
      failure: failureBroadcast,
    });
  });

  it("resets to quote from every phase", () => {
    for (const events of [
      [],
      [{ kind: "submit" } as const],
      [{ kind: "submit" } as const, { kind: "broadcast", signature: "s" } as const],
      [
        { kind: "submit" } as const,
        { kind: "broadcast", signature: "s" } as const,
        { kind: "confirm" } as const,
      ],
      [
        { kind: "submit" } as const,
        { kind: "fail", failure: failureNotBroadcast } as const,
      ],
    ]) {
      const s = tradeReducer(advance(events), { kind: "reset" });
      expect(s).toEqual(INITIAL_TRADE_STATE);
    }
  });
});

describe("tradeReducer — illegal transitions throw", () => {
  it("cannot submit unless armed in quote", () => {
    const submitting = advance([{ kind: "submit" }]);
    expect(() => tradeReducer(submitting, { kind: "submit" })).toThrow(
      IllegalTransitionError,
    );
  });

  it("cannot broadcast from quote (nothing was submitted)", () => {
    expect(() =>
      tradeReducer(INITIAL_TRADE_STATE, { kind: "broadcast", signature: "s" }),
    ).toThrow(IllegalTransitionError);
  });

  it("cannot confirm without a broadcast (confirmed-before-reveal guard)", () => {
    expect(() => tradeReducer(INITIAL_TRADE_STATE, { kind: "confirm" })).toThrow(
      IllegalTransitionError,
    );
    const submitting = advance([{ kind: "submit" }]);
    expect(() => tradeReducer(submitting, { kind: "confirm" })).toThrow(
      IllegalTransitionError,
    );
  });

  it("cannot fail from quote or from terminal states", () => {
    expect(() =>
      tradeReducer(INITIAL_TRADE_STATE, { kind: "fail", failure: failureNotBroadcast }),
    ).toThrow(IllegalTransitionError);
    const confirmed = advance([
      { kind: "submit" },
      { kind: "broadcast", signature: "s" },
      { kind: "confirm" },
    ]);
    expect(() =>
      tradeReducer(confirmed, { kind: "fail", failure: failureBroadcast }),
    ).toThrow(IllegalTransitionError);
    const failed = advance([
      { kind: "submit" },
      { kind: "fail", failure: failureNotBroadcast },
    ]);
    expect(() =>
      tradeReducer(failed, { kind: "fail", failure: failureNotBroadcast }),
    ).toThrow(IllegalTransitionError);
  });

  it("a pre-broadcast failure cannot claim it was broadcast", () => {
    const submitting = advance([{ kind: "submit" }]);
    expect(() =>
      tradeReducer(submitting, { kind: "fail", failure: failureBroadcast }),
    ).toThrow(IllegalTransitionError);
  });
});
