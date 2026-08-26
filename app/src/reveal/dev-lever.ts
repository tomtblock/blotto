/*
 * ?reveal=<beat> dev lever (never linked from the UI — same posture as
 * ?devlevers): jump the takeover's machine to any beat with a fixture
 * outcome, so every state is reachable by hand and by the visual guard.
 *
 * States are reached by EVENT REPLAY through the real reducer, never by
 * constructing them — the `ConfirmedOutcome` brand (machine.ts) makes the
 * post-tell states impossible to forge, and the lever must not be the one
 * caller that cheats.
 */

import type { TxFailure } from "@/tx/types";
import { TAP_COUNT } from "./constants";
import { fixtureRevealOutcome } from "./fixtures";
import { replayReveal, type RevealEvent, type RevealState } from "./machine";
import type { RevealClass } from "./types";

export const LEVER_BEATS = [
  "entry",
  "revealing",
  "strain",
  "stalled",
  "failed",
  "tell",
  "unseal",
  "card",
  "settled",
] as const;

export type LeverBeat = (typeof LEVER_BEATS)[number];

const LEVER_FAILURE: TxFailure = {
  kind: "rpc-failure",
  message: "the network dropped this one — nothing to redo but resend",
  detail: "dev lever: scripted failure",
  broadcast: true,
};

export function isLeverBeat(value: string): value is LeverBeat {
  return (LEVER_BEATS as readonly string[]).includes(value);
}

export function isRevealClass(value: number): value is RevealClass {
  return Number.isInteger(value) && value >= 0 && value <= 5;
}

/** The replay that lands on the requested beat with a fixture outcome. */
export function leverEvents(beat: LeverBeat, classIndex: RevealClass): RevealEvent[] {
  const tap: RevealEvent = { kind: "tap" };
  const fullReveal: RevealEvent[] = Array(TAP_COUNT).fill(tap);
  const confirmed: RevealEvent = {
    kind: "tx_confirmed",
    outcome: fixtureRevealOutcome(classIndex),
  };
  const elapsed: RevealEvent = { kind: "beat_elapsed" };
  switch (beat) {
    case "entry":
      return [];
    case "revealing":
      return [tap];
    case "strain":
      return fullReveal;
    case "stalled":
      return [...fullReveal, { kind: "stall_timeout" }];
    case "failed":
      return [...fullReveal, { kind: "tx_failed", failure: LEVER_FAILURE }];
    case "tell":
      return [...fullReveal, confirmed];
    case "unseal":
      return [...fullReveal, confirmed, elapsed];
    case "card":
      return [...fullReveal, confirmed, elapsed, elapsed];
    case "settled":
      return [...fullReveal, confirmed, elapsed, elapsed, { kind: "dismiss" }];
  }
}

export function leverState(beat: LeverBeat, classIndex: RevealClass): RevealState {
  return replayReveal(leverEvents(beat, classIndex));
}
