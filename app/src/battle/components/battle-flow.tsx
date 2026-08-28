'use client';

/*
 * The seven-battle flow container (roadmap 3.4; restyled by v3 D2): owns the
 * clock and the machine; renders battle screens, the visible 15s timer, the
 * review, and hands the confirmed battles + timings to `onConfirm` — which is
 * where the sealing + register transaction happens (outside this component;
 * this component never sees a wallet).
 *
 * The machine is pure (src/battle/machine.ts); this component's only jobs
 * are feeding ticks and rendering state. R9's lock-current lives in the
 * machine, not here — the component cannot override it.
 *
 * D2 design notes:
 *  - The timer is VISIBLE (R9) and CALM: tabular, steady, no colour shift,
 *    no pulse. Pressure devices are on D3's do-not-build list.
 *  - PHASE-D2-REVIEW: v3 asks for "remaining points big". The allocation
 *    always sums to exactly 100 by construction (the client invariant —
 *    the pentagon redistributes, it never spends a budget), so a remaining
 *    counter would permanently read 0. The five stat integers are the big
 *    display-face numbers instead, with the fixed "= 100" total beside them.
 *  - The confirm is TWO-STEP (v3 D2): "Seal my allocation" arms, then the
 *    §8.6 line renders above the final "Confirm — seal and submit".
 */

import { useEffect, useReducer, useRef, useState } from 'react';
import { COPY } from '@/copy';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
  // The two-step seal: false = review, true = armed for final confirm.
  const [sealArmed, setSealArmed] = useState(false);

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
      <section className="flex flex-col gap-5">
        <header className="flex items-end justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-[12px] uppercase tracking-[0.14em] text-ink-muted">
              {COPY.battle.screenOf(state.screen + 1)}
            </span>
            {/* Seven quiet dots — where you are, never a nag. */}
            <div className="flex gap-1.5" aria-hidden>
              {Array.from({ length: 7 }, (_, i) => (
                <span
                  key={i}
                  className={
                    'h-1.5 w-1.5 rounded-full ' +
                    (i < state.screen
                      ? 'bg-brand'
                      : i === state.screen
                        ? 'bg-ink'
                        : 'bg-overlay')
                  }
                />
              ))}
            </div>
          </div>
          {/* R9: the timer is VISIBLE — and calm: steady ink, no colour shift. */}
          <output
            className="tnum font-display text-[34px] leading-[38px] font-bold text-ink"
            aria-label="seconds remaining"
          >
            {secondsLeft}
          </output>
        </header>
        <div className="h-0.5 w-full overflow-hidden rounded bg-overlay" aria-hidden>
          <div
            className="h-full bg-brand transition-[width] duration-100 ease-linear"
            style={{ width: `${(state.remainingMs / state.timerBudgetMs) * 100}%` }}
          />
        </div>
        <PentagonRadar
          display={state.display}
          onDrag={(stat, value) => dispatch({ type: 'drag', stat, value })}
        />
        <p className="text-center text-[13px] leading-5 text-ink-muted">
          {COPY.battle.timerNote}
        </p>
        <div className="flex gap-3">
          <Button intent="secondary" onClick={() => dispatch({ type: 'even_split' })}>
            {COPY.battle.evenSplit}
          </Button>
          <Button className="ml-auto" size="lg" onClick={() => dispatch({ type: 'lock_in' })}>
            {COPY.battle.lockIn}
          </Button>
        </div>
      </section>
    );
  }

  if (state.phase === 'review') {
    return (
      <section className="flex flex-col gap-5">
        <h2 className="font-display text-[24px] font-bold text-ink">
          {COPY.battle.reviewTitle}
        </h2>
        <Card className="p-1">
          <ol className="flex flex-col">
            {state.battles.map((b, k) => (
              <li
                key={k}
                className={
                  'flex items-center gap-4 px-4 py-2.5 ' +
                  (k > 0 ? 'border-t border-line' : '')
                }
              >
                <span className="text-[12px] uppercase tracking-[0.14em] text-ink-muted">
                  {COPY.battle.screenOf(k + 1)}
                </span>
                <span className="tnum ml-auto font-display text-[18px] font-bold text-ink">
                  {b.join(' · ')}
                </span>
              </li>
            ))}
          </ol>
        </Card>
        {sealArmed ? (
          <div className="flex flex-col gap-3">
            {/* PID §8.6 — above the confirm, always. Do not move it below. */}
            <p className="text-[15px] font-semibold leading-6 text-ink">
              {COPY.pool.decisionsFinal}
            </p>
            <Button size="lg" onClick={() => dispatch({ type: 'confirm' })}>
              {COPY.battle.sealConfirm}
            </Button>
            <Button intent="secondary" onClick={() => setSealArmed(false)}>
              {COPY.battle.sealCancel}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* PID §8.6 — above the seal control on step one as well. */}
            <p className="text-[13px] leading-5 text-ink-muted">
              {COPY.pool.decisionsFinal}
            </p>
            <Button size="lg" onClick={() => setSealArmed(true)}>
              {COPY.battle.seal}
            </Button>
          </div>
        )}
      </section>
    );
  }

  // Confirmed: the parent has the battles; the sealing animation holds the
  // screen until the reveal takeover replaces it.
  return (
    <section aria-live="polite" className="flex flex-col items-center gap-6 py-14">
      <div className="animate-pulse-once relative h-16 w-16" aria-hidden>
        <div className="absolute inset-0 rounded-2xl border-2 border-brand" />
        <div
          className="absolute inset-0 rounded-2xl"
          style={{ boxShadow: 'var(--glow-action)' }}
        />
        {/* A closing shackle: the seal. */}
        <svg viewBox="0 0 24 24" className="absolute inset-0 m-auto h-8 w-8 text-brand">
          <path
            d="M7 10V8a5 5 0 0 1 10 0v2m-9 0h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <p className="animate-rise text-[15px] text-ink-muted">{COPY.battle.sealing}</p>
    </section>
  );
}

export { EVEN_SPLIT };
