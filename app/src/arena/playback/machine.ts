/*
 * The playback machine — a PURE reducer over a compiled beat timeline
 * (src/reveal/machine.ts discipline verbatim): no timers, no Date, no
 * React. The stage component owns ONE timer keyed on the cursor and feeds
 * `beat_elapsed` in; the user's tap is the Pokémon text-box advance and is
 * never lost — extra taps past the end are no-ops (NG-007: nothing about
 * tap timing or count can influence anything).
 *
 * The reducer is TOTAL: unknown (state, event) pairs return the state
 * unchanged. The final beat (`matchup-result`) HOLDS — nothing advances
 * past it; leaving is the caller's affair (a dismiss/replay control).
 */

export interface PlaybackState {
  /** Index into the compiled beat array. */
  cursor: number;
  paused: boolean;
}

export type PlaybackEvent =
  | { kind: 'beat_elapsed' }
  | { kind: 'tap' }
  | { kind: 'skip_to_result' }
  | { kind: 'toggle_pause' }
  | { kind: 'replay' };

export const INITIAL_PLAYBACK_STATE: PlaybackState = { cursor: 0, paused: false };

export function atResult(state: PlaybackState, beatCount: number): boolean {
  return state.cursor >= beatCount - 1;
}

export function playbackReducer(
  state: PlaybackState,
  event: PlaybackEvent,
  beatCount: number
): PlaybackState {
  const last = Math.max(0, beatCount - 1);
  switch (event.kind) {
    case 'beat_elapsed':
      // The clock advances only while playing, and never past the result.
      if (state.paused || state.cursor >= last) return state;
      return { ...state, cursor: state.cursor + 1 };
    case 'tap':
      // Tap advances even while paused (an explicit act beats the pause);
      // at the result it is a no-op, never an error.
      if (state.cursor >= last) return state;
      return { ...state, cursor: state.cursor + 1 };
    case 'skip_to_result':
      return { cursor: last, paused: false };
    case 'toggle_pause':
      return { ...state, paused: !state.paused };
    case 'replay':
      return INITIAL_PLAYBACK_STATE;
  }
}
