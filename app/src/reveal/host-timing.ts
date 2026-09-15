/*
 * The takeover's timer schedule (C9) — which timer, if any, a beat arms,
 * as data. The host component owns the actual setTimeout; keeping the
 * mapping pure pins the choreography in a unit test:
 *
 *   entry → stall_timeout after STALL_THRESHOLD_MS (D-03 come-back)
 *   every other beat → no timer (the card and the terminal beats advance
 *   only by explicit dismiss).
 *
 * Until 2026-09-15 the stall timer belonged to the strain beat ("fully
 * revealed, confirmation not yet landed") and the tell and unseal beats
 * advanced on fixed durations. The founder's instruction of 2026-09-14
 * removed the reveal, so waiting IS the entry beat and the stall timer
 * moved with it; the timed beats are gone.
 */

import { STALL_THRESHOLD_MS } from './constants';
import type { RevealEvent, RevealVisual } from './machine';

export interface BeatTimer {
  event: Extract<RevealEvent['kind'], 'stall_timeout'>;
  ms: number;
}

export function beatTimer(visual: RevealVisual): BeatTimer | null {
  return visual.beat === 'entry' ? { event: 'stall_timeout', ms: STALL_THRESHOLD_MS } : null;
}
