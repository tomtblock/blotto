import { describe, expect, it } from 'vitest';
import {
  INITIAL_PLAYBACK_STATE,
  atResult,
  playbackReducer,
  type PlaybackEvent,
  type PlaybackState,
} from './machine';

const N = 10;
const run = (events: PlaybackEvent[], from: PlaybackState = INITIAL_PLAYBACK_STATE) =>
  events.reduce((s, e) => playbackReducer(s, e, N), from);

describe('playback machine', () => {
  it('the clock and the tap both advance one beat', () => {
    expect(run([{ kind: 'beat_elapsed' }]).cursor).toBe(1);
    expect(run([{ kind: 'tap' }]).cursor).toBe(1);
  });

  it('nothing advances past the result; extra taps are no-ops (NG-007)', () => {
    const atEnd = run(Array(N + 5).fill({ kind: 'tap' }));
    expect(atEnd.cursor).toBe(N - 1);
    expect(atResult(atEnd, N)).toBe(true);
    expect(playbackReducer(atEnd, { kind: 'beat_elapsed' }, N)).toBe(atEnd);
    expect(playbackReducer(atEnd, { kind: 'tap' }, N)).toBe(atEnd);
  });

  it('pause stops the clock but never the tap — an explicit act beats the pause', () => {
    const paused = run([{ kind: 'toggle_pause' }]);
    expect(paused.paused).toBe(true);
    expect(playbackReducer(paused, { kind: 'beat_elapsed' }, N)).toBe(paused);
    expect(playbackReducer(paused, { kind: 'tap' }, N).cursor).toBe(1);
  });

  it('skip lands on the result and clears the pause', () => {
    const s = run([{ kind: 'toggle_pause' }, { kind: 'skip_to_result' }]);
    expect(s).toEqual({ cursor: N - 1, paused: false });
  });

  it('replay is indistinguishable from a fresh start', () => {
    const s = run([{ kind: 'tap' }, { kind: 'tap' }, { kind: 'replay' }]);
    expect(s).toEqual(INITIAL_PLAYBACK_STATE);
  });
});
