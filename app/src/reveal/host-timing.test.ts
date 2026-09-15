/* C9: the takeover's timer schedule, pinned as data.
 *
 * Rewritten in place 2026-09-15 (standing rule 0.7): the founder's
 * instruction of 2026-09-14 removed the reveal, so the strain, tell and
 * unseal beats — and their timers — no longer exist. The stall timer they
 * used to share moved to the waiting beat. */
import { describe, expect, it } from 'vitest';
import { STALL_THRESHOLD_MS } from './constants';
import { beatTimer } from './host-timing';

describe('beatTimer', () => {
  it('the waiting beat arms the stall timer (D-03) — it moved here from the old strain beat', () => {
    expect(beatTimer({ beat: 'entry' })).toEqual({
      event: 'stall_timeout',
      ms: STALL_THRESHOLD_MS,
    });
  });

  it('every other beat arms no timer', () => {
    expect(
      beatTimer({
        beat: 'failed',
        failure: { kind: 'rpc-failure', message: 'x', detail: 'y', broadcast: false, retryable: true },
      })
    ).toBeNull();
    expect(beatTimer({ beat: 'stalled' })).toBeNull();
    expect(beatTimer({ beat: 'card', entryIndex: 0, asset: 'A' })).toBeNull();
    expect(beatTimer({ beat: 'settled', exit: 'entered' })).toBeNull();
  });
});
