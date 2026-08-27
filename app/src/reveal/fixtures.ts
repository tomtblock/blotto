/*
 * Deterministic reveal fixtures — the outcome shape the machine and its tests
 * exercise without a chain.
 *
 * Authored during Phase 0 extraction rather than carried: the predecessor's
 * fixtures described the old product's outcomes (a rarity tier, a bag position in
 * a 420-open collection). These describe this product's — a cosmetic class and a
 * seat in a 64-player pool.
 *
 * Deterministic on purpose. A fixture that varied would make the machine's tests
 * flaky and the dev lever unreproducible, and the stage-discipline scan forbids
 * randomness in stage source for the same reason.
 */

import type { RevealClass, RevealOutcome } from "./types";

/** A stand-in pool address. Not a real account — fixtures never touch a chain. */
export const FIXTURE_POOL_ADDRESS = "PooL1111111111111111111111111111111111111111";

/** A stand-in pass asset address. */
export const FIXTURE_PASS_ASSET = "Pass1111111111111111111111111111111111111111";

/** A stand-in seat. Any seat in `0..63` is valid; this one is arbitrary. */
export const FIXTURE_ENTRY_INDEX = 17;

/**
 * One confirmed outcome for the given class.
 *
 * Everything except the class is fixed, so a test that varies the class varies
 * exactly one thing — which is what makes the machine's "no class leaks before
 * the tell" assertions meaningful.
 */
export function fixtureRevealOutcome(classIndex: RevealClass): RevealOutcome {
  return {
    pool: FIXTURE_POOL_ADDRESS,
    class: classIndex,
    entryIndex: FIXTURE_ENTRY_INDEX,
    asset: FIXTURE_PASS_ASSET,
  };
}
