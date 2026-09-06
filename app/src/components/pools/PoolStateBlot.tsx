'use client';

/*
 * The pool row's 48px state object (master prompt D — Pools): a tiny Blot
 * whose SHAPE reads the pool's lifecycle, drawn from the ten-body readout
 * vocabulary. open=even, filling=durability (the Tank braces as seats
 * fill), sealed=wit, scored=heart, paid=strength, escrow=speed,
 * closed=even at 40%.
 *
 * PHASE-4-REVIEW: the brief says "refunding=mixed-b" without defining it
 * anywhere in the handoff (the scenario doc's "mixed" is a colour pairing,
 * not a shape). Reading intent as "a mixed two-sided body": the Pancake
 * (an even Speed/Durability split — everything handed back both ways).
 * Founder can rename the shape with one line here.
 *
 * Rendered still (reduceMotion) — rows never idle-breathe, and the only
 * motion allowed is a one-shot on a live state CHANGE, which this
 * server-rendered list does not perform. No amount shares this frame:
 * entry and prize figures live in the tier header, not the row.
 */

import type { Allocation } from '@/battle/allocation';
import { EVEN_SPLIT } from '@/battle/allocation';
import { BlotMorph } from '@/components/blot/BlotMorph';
import type { PoolSummary } from '@/data/types';

const SHAPE_FOR_STATE: Record<PoolSummary['state'], Allocation> = {
  Open: EVEN_SPLIT,
  Sealed: [10, 10, 10, 60, 10], // wit
  Scored: [10, 10, 60, 10, 10], // heart
  Paid: [60, 10, 10, 10, 10], // strength
  Refunding: [0, 50, 0, 0, 50], // "mixed-b" — see PHASE note above
  Closed: EVEN_SPLIT,
};

/** Open pools that are nearly full brace: the Tank from 48 seats up. */
const FILLING: Allocation = [10, 10, 10, 10, 60];

export function PoolStateBlot({
  state,
  entrants,
}: {
  state: PoolSummary['state'];
  entrants: number;
}) {
  const allocation = state === 'Open' && entrants >= 48 ? FILLING : SHAPE_FOR_STATE[state];
  return (
    <span className={state === 'Closed' ? 'opacity-40' : undefined} aria-hidden="true">
      <BlotMorph allocation={allocation} size={48} mood="focused" reduceMotion />
    </span>
  );
}
