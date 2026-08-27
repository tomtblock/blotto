'use client';

/*
 * The seven-battle flow container (roadmap 3.4): owns the clock and the
 * machine; renders battle screens, the visible 15s timer, the review, and
 * hands the confirmed battles + timings to `onConfirm` — which is where the
 * sealing + register transaction happens (outside this component; this
 * component never sees a wallet).
 *
 * The machine is pure (src/battle/machine.ts); this component's only jobs
 * are feeding ticks and rendering state. R9's lock-current lives in the
 * machine, not here — the component cannot override it.
 */

import { useEffect, useReducer, useRef } from 'react';
import { COPY } from '@/copy';
import { EVEN_SPLIT, type Allocation } from '../allocation';
import { initialState, reduce, type BattleFlowState } from '../machine';
import { PentagonRadar } from './pentagon-radar';

const TICK_MS = 100;

export interface BattleFlowProps {
  /** From `Pool.timer_seconds` on-chain (R9: 15 at launch). */
  timerSeconds: number;
  onConfirm: (battles: readonly Allocation[], timingsMs: readonly number[]) => void;
}

export function BattleFlow({ timerSeconds, onConfirm }: BattleFlowProps) {
  const [state, dispatch] = useReducer(
    reduce,
    timerSeconds,
    (s): BattleFlowState => initialState(s)
  );
  const confirmed = useRef(false);

  // The clock: a fixed-interval tick while a battle screen is live. Keyed on
  // the screen index so each screen gets a fresh interval.
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
    const secondsLeft = Math.ceil(state.remainingMs / 1000);
    return (
      <section className="flex flex-col gap-6">
        <header className="flex items-baseline justify-between">
          <h2 className="text-lg">{COPY.battle.screenOf(state.screen + 1)}</h2>
          {/* R9: the timer is VISIBLE. */}
          <output
            className="font-mono text-2xl tabular-nums"
            aria-label="seconds remaining"
            data-warning={secondsLeft <= 5 || undefined}
          >
            {secondsLeft}
          </output>
        </header>
        <div
          className="h-1 w-full overflow-hidden rounded bg-[var(--color-border,#333)]"
          aria-hidden
        >
          <div
            className="h-full bg-[var(--color-accent,#7c5cff)] transition-[width]"
            style={{ width: `${(state.remainingMs / state.timerBudgetMs) * 100}%` }}
          />
        </div>
        <PentagonRadar
          display={state.display}
          onDrag={(stat, value) => dispatch({ type: 'drag', stat, value })}
        />
        <p className="text-sm opacity-70">{COPY.battle.timerNote}</p>
        <div className="flex gap-3">
          <button
            type="button"
            className="rounded border px-4 py-2"
            onClick={() => dispatch({ type: 'even_split' })}
          >
            {COPY.battle.evenSplit}
          </button>
          <button
            type="button"
            className="ml-auto rounded bg-[var(--color-accent,#7c5cff)] px-6 py-2 text-white"
            onClick={() => dispatch({ type: 'lock_in' })}
          >
            {COPY.battle.lockIn}
          </button>
        </div>
      </section>
    );
  }

  if (state.phase === 'review') {
    return (
      <section className="flex flex-col gap-6">
        <h2 className="text-lg">{COPY.battle.reviewTitle}</h2>
        <ol className="flex flex-col gap-2">
          {state.battles.map((b, k) => (
            <li key={k} className="flex items-center gap-4 rounded border p-3">
              <span className="text-sm opacity-60">{COPY.battle.screenOf(k + 1)}</span>
              <span className="ml-auto font-mono tabular-nums">{b.join(' · ')}</span>
            </li>
          ))}
        </ol>
        {/* PID §8.6 — above the confirm, always. */}
        <p className="text-sm font-medium">{COPY.pool.decisionsFinal}</p>
        <button
          type="button"
          className="rounded bg-[var(--color-accent,#7c5cff)] px-6 py-3 text-white"
          onClick={() => dispatch({ type: 'confirm' })}
        >
          {COPY.battle.confirm}
        </button>
      </section>
    );
  }

  // Confirmed: the parent has the battles; render a settling placeholder.
  return (
    <section aria-live="polite" className="py-8 text-center opacity-70">
      …
    </section>
  );
}

export { EVEN_SPLIT };
