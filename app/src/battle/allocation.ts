/*
 * The allocation VOCABULARY shared by every client surface that draws or
 * carries one: the stat count, the fixed stat order, the sum, the tuple
 * type, and the even split every screen opens at.
 *
 * THIS MODULE HOLDS NO INTERACTION AND NO GUARD. It used to hold both, and
 * two headers said so after neither was true (audit 2026-09-11, A-25/F-17).
 * Where each actually lives:
 *
 *  - THE INTERACTION is `components/blot/rebalance.ts` — the dial-coupling
 *    rule behind <StatDials />. Dragging stat k to a target re-apportions
 *    the other four proportionally, integer-only, largest-remainder, so the
 *    five values sum to exactly 100 after every pointer event. Its 10,000
 *    random-drag test is in `components/blot/rebalance.test.ts`. The
 *    raw-weight model this file used to carry belonged to the pentagon
 *    radar, which <BlotMorph /> + <StatDials /> replaced; it had no caller
 *    and is gone with it.
 *
 *  - THE SUBMISSION-BOUNDARY GUARD is `encodePayload` in
 *    `backend/sealing/src/payload.ts`, reached from `entry/submit.ts` on
 *    every entry. It encodes the battle set through `encodeBattleSet` →
 *    `assertBattleSet` → `assertAllocation`
 *    (`backend/scoring/src/allocation.ts`), which throws unless every
 *    battle is five non-negative integers summing to exactly 100 in the
 *    fixed stat order. Nothing can reach the chain around it: the sealed
 *    ciphertext and the committed `battles_hash` are both derived from the
 *    bytes that call produces. The SAME module refuses a violating set
 *    again at reveal, so client and crank enforce one rule from one source.
 *
 * PID §4.6 is the invariant; PID §4.3 is why the interaction offers no
 * presets, quick-set chips, named shapes or snapping, and is to be refused
 * in review: any prominent discrete target collapses the 4,598,126-option
 * space toward 126 and the draw rate from 7% toward 86%. There is ONE
 * button: even split.
 */

export const STATS = 5;
export const ALLOCATION_SUM = 100;
export const STAT_NAMES = ['Strength', 'Speed', 'Heart', 'Wit', 'Durability'] as const;

/** Five non-negative integers summing to exactly 100, fixed stat order. */
export type Allocation = readonly [number, number, number, number, number];

export const EVEN_SPLIT: Allocation = [20, 20, 20, 20, 20];
