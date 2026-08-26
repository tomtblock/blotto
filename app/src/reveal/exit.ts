/*
 * Reveal exit contract — the cache reads the surface behind the reveal renders
 * from, invalidated when the takeover settles so the RETURN is honest: whatever
 * the reveal changed is re-read on arrival instead of served from the pre-reveal
 * cache.
 *
 * Carried from the predecessor repository. The MECHANISM is what was worth
 * keeping; the key list was entirely the old product's and is not carried.
 *
 * Explicit on purpose: TanStack Query's default staleTime-0 + refetch-on-mount
 * would USUALLY re-read on remount anyway, but an honesty contract must not hang
 * off a tunable default — one `defaultOptions` edit away from silently serving
 * stale state. Invalidation (not removal) keeps the stale value on screen while
 * the refetch runs, so the surface never regresses to its pending state on
 * return.
 *
 * TODO(phase-3): fill REVEAL_EXIT_QUERY_PREFIXES with this product's real query
 * keys once the surfaces exist. Candidates, from TECH-ARCH §3.3 and §10: the
 * pool's entrant count and state, the player's own entry, and the pass just
 * minted. The list must be filled at the same time as the queries themselves —
 * a key added without a matching entry here is a surface that lies on return,
 * and that is exactly the failure this module exists to prevent.
 *
 * The predecessor guarded against that with a test pinning each prefix against
 * the consuming component's source, so a key rename could not silently strand
 * the list. That test is not carried (it asserted the old product's keys against
 * files that no longer exist) and SHOULD be rewritten in Phase 3 — see
 * EXTRACTION-REPORT.md.
 */

/** The one method this module needs from a QueryClient — structural, so tests
 * can pass a recording stub without constructing a real client. */
export interface RevealExitQueryClient {
  invalidateQueries(filter: { queryKey: readonly unknown[] }): unknown;
}

/**
 * QueryKey prefixes invalidated on reveal exit. Prefix match is the point: a
 * single-element prefix catches every parameterised instance of that query.
 *
 * EMPTY IN PHASE 0 — see the TODO above. Empty means `invalidateRevealExitQueries`
 * is a no-op, which is correct while there are no surfaces to invalidate and
 * wrong the moment there are.
 */
export const REVEAL_EXIT_QUERY_PREFIXES: readonly (readonly string[])[] = [];

/** Invalidate every read the reveal's outcome can have changed. Called by the
 * takeover on `settled`, before control returns to the surface behind it. */
export function invalidateRevealExitQueries(
  client: RevealExitQueryClient,
): void {
  for (const queryKey of REVEAL_EXIT_QUERY_PREFIXES) {
    client.invalidateQueries({ queryKey });
  }
}
