/* C9: the takeover's timer schedule, pinned as data. */
import { describe, expect, it } from 'vitest';
import {
  STALL_THRESHOLD_MS,
  TELL_DURATION_MS,
  TELL_EXTENDED_DURATION_MS,
  UNSEAL_DURATION_MS,
} from './constants';
import { beatTimer } from './host-timing';

describe('beatTimer', () => {
  it('strain arms the stall timer (D-03), nothing else does', () => {
    expect(beatTimer({ beat: 'strain' })).toEqual({
      event: 'stall_timeout',
      ms: STALL_THRESHOLD_MS,
    });
  });

  it('tell and unseal advance on their fixed durations', () => {
    expect(beatTimer({ beat: 'tell', class: 0, extended: false })).toEqual({
      event: 'beat_elapsed',
      ms: TELL_DURATION_MS,
    });
    expect(beatTimer({ beat: 'tell', class: 4, extended: true })).toEqual({
      event: 'beat_elapsed',
      ms: TELL_EXTENDED_DURATION_MS,
    });
    expect(beatTimer({ beat: 'unseal', class: 2 })).toEqual({
      event: 'beat_elapsed',
      ms: UNSEAL_DURATION_MS,
    });
  });

  it('tap-driven and terminal beats arm no timer', () => {
    expect(beatTimer({ beat: 'entry' })).toBeNull();
    expect(beatTimer({ beat: 'revealing', tapsSoFar: 1 })).toBeNull();
    expect(
      beatTimer({
        beat: 'failed',
        failure: { kind: 'rpc-failure', message: 'x', detail: 'y', broadcast: false, retryable: true },
      })
    ).toBeNull();
    expect(beatTimer({ beat: 'stalled' })).toBeNull();
    expect(beatTimer({ beat: 'card', class: 1, entryIndex: 0, asset: 'A' })).toBeNull();
    expect(beatTimer({ beat: 'settled', exit: 'entered' })).toBeNull();
  });
});
