'use client';

/*
 * The seven-battle flow container (roadmap 3.4; UI constitution 6.4/6.5):
 * owns the clock and the machine; renders battle screens, the visible 15s
 * timer, the review, and hands the confirmed battles + timings to
 * `onConfirm` — where the sealing + register transaction happens (outside
 * this component; this component never sees a wallet).
 *
 * The machine is pure (src/battle/machine.ts); this component's only jobs
 * are feeding ticks and rendering state. R9's lock-current lives in the
 * machine, not here — the component cannot override it.
 *
 * Motion, by grammar word:
 *  - Lock-in: the locked shape STAMPS (WEIGHT, with one edge flash), then
 *    FROSTS, then slides off while the next even split enters. The overlay
 *    is presentation only — the machine has already advanced, and the next
 *    screen is interactive underneath from the first frame (nothing
 *    blocks, hard constraint 8). Timeout locks play the same sequence:
 *    the choreography keys off the screen advancing, not off the cause.
 *  - Progress dots: a completed battle's dot is a miniature frosted
 *    pentagon silhouette — the seal, echoed small.
 *  - The timer is a thin arc that drains smoothly — a metronome, not an
 *    alarm: steady ink number, no colour shift, no shake, no sound. There
 *    is no opponent waiting (R9; pressure devices are do-not-build).
 *  - Review: the seven battles are small FROSTED cards; hovering (or
 *    focusing) one de-frosts it for its owner only. Submit sends all
 *    seven TRAVELing into the pool glyph.
 */

import { useEffect, useReducer, useRef, useState } from 'react';
import { COPY } from '@/copy';
import { Button } from '@/components/ui/button';
import { PentagonMini } from '@/components/ui/pentagon-mini';
import { Frost } from '@/components/ui/frost';
import { usePrefersReducedMotion } from '@/reveal/stages/use-reduced-motion';
import { polygonPoints } from '../geometry';
import { EVEN_SPLIT, type Allocation } from '../allocation';
import { initialState, reduce, type BattleFlowState } from '../machine';
import { PentagonRadar } from './pentagon-radar';

const TICK_MS = 100;
/** The lock-in overlay's full run: stamp 200 + frost 400 + slide 250. */
const LOCK_OVERLAY_MS = 950;

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
  const reduced = usePrefersReducedMotion();
  // The two-step seal: false = review, true = armed for final confirm.
  const [sealArmed, setSealArmed] = useState(false);
  // The just-locked shape, replayed as the stamp→frost→slide overlay.
  const [locked, setLocked] = useState<{ allocation: Allocation; key: number } | null>(null);
  const lastScreen = useRef(0);

  // The clock: a fixed-interval tick while a battle screen is live. Keyed on
  // the screen index so each screen gets a fresh interval.
  const liveScreen = state.phase === 'battle' ? state.screen : -1;
  useEffect(() => {
    if (liveScreen < 0) return;
    const id = setInterval(() => dispatch({ type: 'tick', ms: TICK_MS }), TICK_MS);
    return () => clearInterval(id);
  }, [liveScreen]);

  // Detect a battle locking (screen advanced, or battle → review) and play
  // the WEIGHT + FROST exit for the shape that just sealed.
  useEffect(() => {
    const screenNow = state.phase === 'battle' ? state.screen : 7;
    const prev = lastScreen.current;
    if (screenNow <= prev) return;
    lastScreen.current = screenNow;
    if (reduced) return;
    const sealed = state.phase === 'battle' ? state.locked : state.battles;
    const sealedShape = sealed[prev];
    if (!sealedShape) return;
    setLocked({ allocation: sealedShape, key: prev });
    const t = setTimeout(() => setLocked(null), LOCK_OVERLAY_MS);
    return () => clearTimeout(t);
  }, [state, reduced]);

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
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] uppercase tracking-[0.14em] text-ink-muted">
              {COPY.battle.screenOf(state.screen + 1)}
            </span>
            <ProgressDots current={state.screen} />
          </div>
          <TimerArc
            secondsLeft={secondsLeft}
            fraction={state.remainingMs / state.timerBudgetMs}
          />
        </header>

        <div className="relative">
          {/* Fresh screen enters; keyed so each battle gets one enter. */}
          <div key={state.screen} className={reduced ? undefined : 'animate-enter'}>
            <PentagonRadar
              display={state.display}
              onDrag={(stat, value) => dispatch({ type: 'drag', stat, value })}
            />
          </div>

          {/* The sealed shape's exit: stamp → frost → slide off. Pointer
              events pass through; the new screen is live underneath. */}
          {locked ? (
            <div
              key={locked.key}
              aria-hidden
              className="lock-slide-off pointer-events-none absolute inset-x-0 top-0 flex justify-center"
            >
              <div className="animate-stamp edge-flash">
                <div className="relative">
                  <PentagonMini allocation={locked.allocation} size={300} />
                  <div className="veil-condense absolute inset-0">
                    <div className="frost-blur h-full w-full">
                      <PentagonMini allocation={locked.allocation} size={300} />
                    </div>
                    <div className="frost-crystal" />
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <p className="text-center text-[13px] leading-5 text-ink-muted">
          {COPY.battle.timerNote}
        </p>
        <div className="flex gap-3">
          {/* The ONLY shortcut button — no presets, no chips (PID §4.3). */}
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

        {/* Seven sealed cards. Hovering or focusing one de-frosts it for
            its owner only — everyone else sees frost until the pool
            closes. */}
        <ol className="grid grid-cols-4 gap-3 sm:grid-cols-7">
          {state.battles.map((b, k) => (
            <ReviewCard key={k} index={k} allocation={b} />
          ))}
        </ol>
        <p className="text-[13px] leading-5 text-ink-muted">{COPY.pool.sealed}</p>

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

  // Confirmed: the seven sealed battles TRAVEL together into the pool
  // glyph while the parent runs the real submit; the reveal takeover
  // replaces this screen when the outcome resolves.
  return (
    <section aria-live="polite" className="flex flex-col items-center gap-6 py-14">
      <div className="relative flex h-40 w-full max-w-[360px] items-end justify-center" aria-hidden>
        {/* The pool glyph: a small seat ring outline, receiving. */}
        <div
          className={
            (reduced ? '' : 'animate-light-in ') +
            'flex h-16 w-16 items-center justify-center rounded-full border-2 border-brand'
          }
          style={{ boxShadow: 'var(--glow-action)' }}
        >
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-brand">
            <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.4 1.8" />
          </svg>
        </div>
        {/* Seven sealed minis converging on the glyph. */}
        {!reduced &&
          state.battles.map((b, k) => (
            <div
              key={k}
              className="to-pool absolute top-0"
              style={
                {
                  left: `${6 + k * 13}%`,
                  '--tx': `${(50 - (6 + k * 13)) * 3.4}px`,
                  '--ty': '96px',
                  animationDelay: `${k * 40}ms`,
                } as React.CSSProperties
              }
            >
              <Frost frosted>
                <PentagonMini allocation={b} size={34} />
              </Frost>
            </div>
          ))}
      </div>
      <p className={(reduced ? '' : 'animate-enter ') + 'text-[15px] text-ink-muted'}>
        {COPY.battle.sealing}
      </p>
    </section>
  );
}

/** Seven quiet dots — a completed battle's dot is a miniature frosted
 * pentagon silhouette (the seal, echoed small). Never a nag. */
function ProgressDots({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {Array.from({ length: 7 }, (_, i) =>
        i < current ? (
          <svg key={i} viewBox="0 0 100 100" className="h-3 w-3">
            <polygon
              points={polygonPoints([78, 78, 78, 78, 78], 46, 50, 50)}
              fill="color-mix(in srgb, var(--color-brand) 30%, transparent)"
              stroke="var(--color-brand)"
              strokeWidth={8}
              strokeLinejoin="round"
              opacity={0.85}
            />
          </svg>
        ) : (
          <span
            key={i}
            className={
              'h-1.5 w-1.5 rounded-full ' + (i === current ? 'bg-ink' : 'bg-overlay')
            }
          />
        )
      )}
    </div>
  );
}

/** R9: the timer is VISIBLE — and calm. A thin arc drains smoothly around
 * a steady ink number. No red, no shake, no tick sound. */
function TimerArc({ secondsLeft, fraction }: { secondsLeft: number; fraction: number }) {
  const R_ARC = 24;
  const C = 2 * Math.PI * R_ARC;
  return (
    <div className="relative h-14 w-14" aria-hidden={false}>
      <svg viewBox="0 0 56 56" className="absolute inset-0 h-full w-full -rotate-90">
        <circle cx="28" cy="28" r={R_ARC} fill="none" stroke="var(--color-overlay)" strokeWidth="2.5" />
        <circle
          cx="28"
          cy="28"
          r={R_ARC}
          fill="none"
          stroke="var(--color-brand)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - Math.max(0, Math.min(1, fraction)))}
          style={{ transition: 'stroke-dashoffset 100ms linear' }}
        />
      </svg>
      <output
        className="tnum absolute inset-0 flex items-center justify-center font-display text-[22px] font-bold text-ink"
        aria-label="seconds remaining"
      >
        {secondsLeft}
      </output>
    </div>
  );
}

/** One sealed battle on the review screen: frosted at rest, readable to
 * its owner on hover/focus/press. */
function ReviewCard({ index, allocation }: { index: number; allocation: Allocation }) {
  const [peek, setPeek] = useState(false);
  return (
    <li className="flex flex-col items-center gap-1">
      <button
        type="button"
        className="rounded-xl border border-line bg-raised p-1.5"
        onPointerEnter={() => setPeek(true)}
        onPointerLeave={() => setPeek(false)}
        onFocus={() => setPeek(true)}
        onBlur={() => setPeek(false)}
        aria-label={`${COPY.battle.screenOf(index + 1)}: ${allocation.join(', ')}`}
      >
        <Frost frosted={!peek}>
          <PentagonMini allocation={allocation} size={56} />
        </Frost>
      </button>
      <span className="tnum text-[10px] text-ink-muted">{index + 1}</span>
    </li>
  );
}

export { EVEN_SPLIT };
