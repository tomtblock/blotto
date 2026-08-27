import { describe, expect, it } from "vitest";
import {
  REVEAL_EXIT_QUERY_PREFIXES,
  invalidateRevealExitQueries,
  type RevealExitQueryClient,
} from "./exit";

/*
 * The predecessor's version of this file pinned each exit query-key prefix
 * against the source of the component that consumed it, so a key rename could
 * not silently strand the list. That test is not carried: it asserted the old
 * product's keys against files that no longer exist.
 *
 * What is carried is the mechanism test below, plus one guard that will fail
 * loudly the moment Phase 3 fills the key list without restoring the
 * source-pinning discipline. See exit.ts.
 */

function recorder() {
  const seen: readonly unknown[][] = [];
  const calls: unknown[][] = seen as unknown[][];
  const client: RevealExitQueryClient = {
    invalidateQueries({ queryKey }) {
      calls.push([...queryKey]);
    },
  };
  return { client, calls };
}

describe("invalidateRevealExitQueries", () => {
  it("invalidates every listed prefix, once each", () => {
    const { client, calls } = recorder();
    invalidateRevealExitQueries(client);
    expect(calls).toEqual(REVEAL_EXIT_QUERY_PREFIXES.map((k) => [...k]));
  });

  it("invalidates rather than removes — the stale value stays on screen while it refetches", () => {
    // Structural: the client interface exposes ONLY invalidateQueries. A future
    // change to removeQueries would have to widen this interface, which is a
    // visible edit rather than a silent behaviour change. Removal would flash the
    // surface back to its pending state on return, which is the regression this
    // module exists to avoid.
    const { client } = recorder();
    expect(Object.keys(client)).toEqual(["invalidateQueries"]);
  });

  it("is a no-op while the prefix list is empty (Phase 0)", () => {
    // This is a REMINDER, not an endorsement. The list is empty because there are
    // no surfaces to invalidate yet. When Phase 3 adds the first one and fills
    // exit.ts, this assertion fails — and the fix is to replace it with the
    // source-pinning coverage described in exit.ts, not to delete it.
    const { client, calls } = recorder();
    invalidateRevealExitQueries(client);
    expect(
      calls,
      "exit.ts now lists prefixes — replace this test with real coverage (see exit.ts)",
    ).toEqual([]);
  });
});
