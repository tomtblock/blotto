'use client';

/*
 * The arena's builder container — a SKIN over the real seven-battle machine,
 * structurally a sibling of src/battle/components/battle-flow.tsx (which is
 * a legal/compliance surface and stays untouched).
 *
 * THE MECHANIC CANNOT DRIFT HERE BY CONSTRUCTION: this component imports
 * `initialState`/`reduce` from src/battle/machine.ts and dispatches ONLY the
 * existing BattleFlowEvent alphabet (drag / even_split / tick / lock_in /
 * confirm). R9's lock-current lives in the machine; the 100-point invariant
 * lives in src/battle/allocation.ts; the pentagon is the SHARED
 * PentagonRadar. This file adds character framing around them and nothing
 * else. Any new event type into the battle machine is a review red flag.
 *
 * Same `onConfirm(battles, timingsMs)` signature as BattleFlow, so the
 * existing sealed-submit path plugs in verbatim.
 */

import { useEffect, useReducer, useRef } from 'react';
import type { Allocation } from '@/battle/allocation';
import { initialState, reduce, type BattleFlowState } from '@/battle/machine';
import { CharacterSheet } from './character-sheet';
import { TeamReview } from './team-review';

const TICK_MS = 100;

export interface ArenaBuilderFlowProps {
  /** From `Pool.timer_seconds` on-chain (R9: 15 at launch). */
  timerSeconds: number;
  onConfirm: (battles: readonly Allocation[], timingsMs: readonly number[]) => void;
}

export function ArenaBuilderFlow({ timerSeconds, onConfirm }: ArenaBuilderFlowProps) {
  const [state, dispatch] = useReducer(
    reduce,
    timerSeconds,
    (s): BattleFlowState => initialState(s)
  );
  const confirmed = useRef(false);

  // The clock: fixed-interval ticks while a screen is live, keyed on the
  // screen index so each character gets a fresh interval (battle-flow.tsx's
  // exact discipline — the machine owns the timeout, we only feed time).
  const liveScreen = state.phase === 'battle' ? state.screen : -1;
  useEffect(() => {
    if (liveScreen < 0) return;
    const id = setInterval(() => dispatch({ type: 'tick', ms: TICK_MS }), TICK_MS);
    return () => clearInterval(id);
  }, [liveScreen]);

  useEffect(() => {
    if (state.phase === 'confirmed' && !confirmed.current) {
      confirmed.current = true;
      onConfirm(state.battles, state.timingsMs);
    }
  }, [state, onConfirm]);

  if (state.phase === 'battle') {
    return <CharacterSheet state={state} dispatch={dispatch} />;
  }
  if (state.phase === 'review') {
    return <TeamReview battles={state.battles} onConfirm={() => dispatch({ type: 'confirm' })} />;
  }
  return (
    <section aria-live="polite" className="py-8 text-center opacity-70">
      …
    </section>
  );
}
