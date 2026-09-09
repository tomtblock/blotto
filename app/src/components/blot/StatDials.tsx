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
}) {
  const name = STAT_NAMES[k];
  const value = target[k];
  const lastHaptic = useRef(value);

  const commit = useCallback(
    (t: number) => {
      const clamped = Math.max(0, Math.min(100, Math.round(t)));
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
    [k, onDrag]
  );

  // The dragged row pins to the target (dial and number never disagree);
  // resting rows glide on the spring display.
  const knob = dragStat === k ? value : shown;
  const heat = Math.max(0, temperature);
  const cold = Math.max(0, -temperature);
  const active = dragStat === k;

  return (
    <div
      className={`blot-dial-row flex items-center gap-3${active ? ' is-active' : ''}`}
      style={{
        ['--dial-fill' as string]: `${knob}%`,
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
        max={100}
        step="any"
        value={knob}
        disabled={disabled}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={`${name} ${value} of 100`}
        aria-label={name}
        onChange={(e) => commit(Number(e.target.value))}
        onPointerDown={() => onDragStart?.(k)}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        onKeyDown={(e) => {
          let next: number | null = null;
          if (e.key in KEY_STEP) next = value + KEY_STEP[e.key] * (e.shiftKey ? 5 : 1);
          else if (e.key === 'Home') next = 0;
          else if (e.key === 'End') next = 100;
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
    </div>
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
}: StatDialsProps) {
  const reduced = usePrefersReducedMotion();
  const temps = useDialThermals(target, reduced);
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
        />
      ))}
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
