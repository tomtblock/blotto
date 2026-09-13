'use client';

/*
 * <StatDials /> — five dials, one per stat in the fixed order, on the
 * plum deck of the machine (architect brief §4; founder 2026-09-09: "the
 * dials need to be more prominent and flashy … when a dial is increased it
 * should be heating up and skills which are decreasing are showing blue
 * for cold"). Each row: mono label, an 18u track with a 34u yellow knob,
 * the live integer in the display face. The knob colour is the founder's
 * call, on the record: yellow never wears a number here (the value is ink).
 *
 * TEMPERATURE: a row that is being raised glows toward the hot red and a
 * row giving way cools toward the blue (dial-thermals.ts); the glow decays
 * to the plain dial about a second after the hand stops. The colour is
 * feedback, never a value — the number stays ink.
 *
 * Built on native <input type="range"> so pointer capture, grab-anywhere
 * tracks and slider semantics come from the platform; the keyboard map
 * (brief §4) is implemented on top so pointer and keyboard produce
 * IDENTICAL target sequences: Arrow ±1, Shift+Arrow ±5, PageUp/Down ±10,
 * Home/End 0/100.
 *
 * The rows the player is NOT dragging follow the ANIMATED display values,
 * not the targets — the player watches the budget flow out of one stat
 * into the others in sync with the body. That feedback is the tutorial.
 *
 * ONE button: Even split (quiet intent, PID §4.3 — no presets, no named
 * shapes, no snapping; any prominent discrete target collapses the
 * 4.6M-option space and the 7% draw rate).
 */

import { useCallback, useRef } from 'react';
import { STAT_NAMES, type Allocation } from '@/battle/allocation';
import { COPY } from '@/copy';
import { usePrefersReducedMotion } from './springs';
import { useDialThermals } from './dial-thermals';
import { NO_LOCKS, maxTarget, type Locks } from './rebalance';
import './blot.css';

export interface StatDialsProps {
  /** The real allocation — five integers summing to 100. */
  target: Allocation;
  /** The spring-animated values the knobs of the OTHER rows follow. */
  display: readonly number[];
  /** Index of the row the pointer is currently dragging, or null. */
  dragStat: number | null;
  /** The player moved stat `k` to `t` (integer 0..100). */
  onDrag: (k: number, t: number) => void;
  onDragStart?: (k: number) => void;
  onDragEnd?: () => void;
  /** The one permitted quick action — rebalance back to 20×5. */
  onEvenSplit?: () => void;
  disabled?: boolean;
  /**
   * DIAL LOCKS (founder 2026-09-13). A locked stat keeps its value while
   * the other dials move; the others share what remains, and each unlocked
   * dial's RANGE shrinks to what it can actually reach (rebalance.ts
   * `maxTarget`). That is the whole of how the budget is shown — as range,
   * never as a number (PID §4.2: no points-remaining counter). Both props
   * are optional: the landing demo and the gallery render plain dials.
   */
  locks?: Locks;
  onToggleLock?: (k: number) => void;
}

const KEY_STEP: Record<string, number> = {
  ArrowRight: 1,
  ArrowUp: 1,
  ArrowLeft: -1,
  ArrowDown: -1,
  PageUp: 10,
  PageDown: -10,
};

function DialRow({
  k,
  target,
  shown,
  temperature,
  dragStat,
  onDrag,
  onDragStart,
  onDragEnd,
  disabled,
  locks,
  onToggleLock,
}: {
  k: number;
  target: Allocation;
  shown: number;
  temperature: number;
  dragStat: number | null;
  onDrag: (k: number, t: number) => void;
  onDragStart?: (k: number) => void;
  onDragEnd?: () => void;
  disabled: boolean;
  locks: Locks;
  onToggleLock?: (k: number) => void;
}) {
  const name = STAT_NAMES[k];
  const value = target[k];
  const lastHaptic = useRef(value);
  const locked = locks[k] === true;
  // With the other four locked this stat is determined: it cannot move
  // either way, so the dial is held rather than left to snap back.
  const pinned = !locked && locks.filter(Boolean).length === 4;
  // The most this dial can reach given the locks — its range. 100 with none.
  const max = maxTarget(target, k, locks);

  const commit = useCallback(
    (t: number) => {
      const clamped = Math.max(0, Math.min(max, Math.round(t)));
      // Haptic tick on every multiple of 5 crossed, where supported —
      // a texture, not a signal; nothing reads it back (brief §4).
      if (Math.floor(clamped / 5) !== Math.floor(lastHaptic.current / 5)) {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate?.(8);
        }
      }
      lastHaptic.current = clamped;
      onDrag(k, clamped);
    },
    [k, max, onDrag]
  );

  // The dragged row pins to the target (dial and number never disagree);
  // resting rows glide on the spring display.
  const knob = dragStat === k ? value : shown;
  const heat = Math.max(0, temperature);
  const cold = Math.max(0, -temperature);
  const active = dragStat === k;

  // The knob's position and the track's fill are drawn against the FULL
  // track, so a shrunken range reads as a shaded, unreachable stretch at
  // the right — the budget the locked stats hold, shown, never counted.
  const canLock = onToggleLock !== undefined;

  return (
    <div
      className={`blot-dial-row flex items-center gap-3${active ? ' is-active' : ''}${locked ? ' is-locked' : ''}`}
      style={{
        ['--dial-fill' as string]: `${knob}%`,
        ['--dial-max' as string]: `${max}%`,
        ['--dial-heat' as string]: heat.toFixed(3),
        ['--dial-cold' as string]: cold.toFixed(3),
      }}
    >
      <span className="blot-dial-label w-24 shrink-0 font-mono text-[12px] uppercase tracking-[0.12em]">
        {name}
      </span>
      <input
        type="range"
        min={0}
        max={max}
        step="any"
        value={Math.min(knob, max)}
        disabled={disabled || locked || pinned}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={locked ? COPY.battle.lockedStat(name) : `${name} ${value} of ${max}`}
        aria-label={name}
        onChange={(e) => commit(Number(e.target.value))}
        onPointerDown={() => onDragStart?.(k)}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        onKeyDown={(e) => {
          let next: number | null = null;
          if (e.key in KEY_STEP) next = value + KEY_STEP[e.key] * (e.shiftKey ? 5 : 1);
          else if (e.key === 'Home') next = 0;
          else if (e.key === 'End') next = max;
          if (next !== null) {
            e.preventDefault();
            onDragStart?.(k);
            commit(next);
          }
        }}
        onKeyUp={onDragEnd}
        className="blot-dial min-w-0 flex-1"
      />
      <span className="blot-dial-readout tnum w-14 shrink-0 text-right font-display text-[32px] font-extrabold leading-none">
        {value}
      </span>
      {canLock ? (
        <button
          type="button"
          aria-pressed={locked}
          aria-label={locked ? COPY.battle.unlockStat(name) : COPY.battle.lockStat(name, value)}
          title={locked ? COPY.battle.unlockStat(name) : COPY.battle.lockStat(name, value)}
          disabled={disabled}
          onClick={() => onToggleLock?.(k)}
          data-testid={`lock-${k}`}
          className="blot-dial-lock grid h-11 w-11 shrink-0 place-items-center rounded-full"
        >
          <LockGlyph locked={locked} />
        </button>
      ) : null}
    </div>
  );
}

/** A padlock, open or shut — 1.8 stroke on the 24-grid like the tab icons. */
function LockGlyph({ locked }: { locked: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      {locked ? <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /> : <path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7" />}
      <circle cx="12" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function StatDials({
  target,
  display,
  dragStat,
  onDrag,
  onDragStart,
  onDragEnd,
  onEvenSplit,
  disabled = false,
  locks = NO_LOCKS,
  onToggleLock,
}: StatDialsProps) {
  const reduced = usePrefersReducedMotion();
  const temps = useDialThermals(target, reduced);
  const anyLocked = locks.some(Boolean);
  return (
    <div className="flex flex-col gap-3.5">
      {STAT_NAMES.map((_, k) => (
        <DialRow
          key={STAT_NAMES[k]}
          k={k}
          target={target}
          shown={display[k] ?? target[k]}
          temperature={temps[k] ?? 0}
          dragStat={dragStat}
          onDrag={onDrag}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          disabled={disabled}
          locks={locks}
          onToggleLock={onToggleLock}
        />
      ))}
      {anyLocked ? (
        <p className="font-mono text-[11px] tracking-wide text-game-ink-muted" aria-live="polite">
          {COPY.battle.locksHint}
        </p>
      ) : null}
      {onEvenSplit && (
        <button
          type="button"
          onClick={onEvenSplit}
          disabled={disabled}
          className="self-start rounded-full px-3 py-1.5 font-mono text-[12px] uppercase tracking-wide text-game-ink-muted underline decoration-game-ink-muted/50 underline-offset-4 hover:text-game-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cream disabled:opacity-50"
        >
          {COPY.battle.evenSplit}
        </button>
      )}
    </div>
  );
}
