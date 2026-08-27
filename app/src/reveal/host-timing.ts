/*
 * The takeover's timer schedule (C9) — which timer, if any, a beat arms,
 * as data. The host component owns the actual setTimeout; keeping the
 * mapping pure pins the choreography in a unit test:
 *
 *   strain  → stall_timeout after STALL_THRESHOLD_MS (D-03 come-back)
 *   tell    → beat_elapsed after its (possibly extended) duration
 *   unseal  → beat_elapsed after UNSEAL_DURATION_MS
 *   every other beat → no timer (entry/revealing are tap-driven; card and
 *   the terminal beats advance only by explicit dismiss).
 */

import {
  STALL_THRESHOLD_MS,
  TELL_DURATION_MS,
  TELL_EXTENDED_DURATION_MS,
  UNSEAL_DURATION_MS,
} from './constants';
import type { RevealEvent } from './machine';
import type { RevealVisual } from './machine';

export interface BeatTimer {
  event: Extract<RevealEvent['kind'], 'beat_elapsed' | 'stall_timeout'>;
  ms: number;
}

export function beatTimer(visual: RevealVisual): BeatTimer | null {
  switch (visual.beat) {
    case 'strain':
      return { event: 'stall_timeout', ms: STALL_THRESHOLD_MS };
    case 'tell':
      return {
        event: 'beat_elapsed',
        ms: visual.extended ? TELL_EXTENDED_DURATION_MS : TELL_DURATION_MS,
      };
    case 'unseal':
      return { event: 'beat_elapsed', ms: UNSEAL_DURATION_MS };
    default:
      return null;
  }
}
