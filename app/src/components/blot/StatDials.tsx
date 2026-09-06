'use client';

/*
 * <StatDials /> — five dials, one per stat in the fixed order, on the
 * berry card (architect brief §4; Figma page 07, node 34:13). Each row:
 * mono label, a 14u pink-filled track with a 28u yellow knob, the live
 * integer in the display face. The knob colour is the founder's call, on
 * the record: the brief and the prototype both draw the yellow knob
 * inside the plum card — the "yellow = paid amounts" reservation applies
 * to NUMBERS, and yellow never wears a number here (the value is ink).
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
  dragStat,
  onDrag,
  onDragStart,
  onDragEnd,
  disabled,
}: {
  k: number;
  target: Allocation;
  shown: number;
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

  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 font-mono text-[13px] uppercase tracking-wide text-game-ink-muted">
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
        style={{ ['--dial-fill' as string]: `${knob}%` }}
      />
      <span className="tnum w-12 shrink-0 text-right font-display text-[28px] font-bold leading-none text-game-ink">
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
  return (
    <div className="flex flex-col gap-4">
      {STAT_NAMES.map((_, k) => (
        <DialRow
          key={STAT_NAMES[k]}
          k={k}
          target={target}
          shown={display[k] ?? target[k]}
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
          Even split
        </button>
      )}
    </div>
  );
}
