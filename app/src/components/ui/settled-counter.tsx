'use client';

/*
 * SettledCounter (UI constitution PART 5.8) — for "Paid to players to
 * date" and similar. It updates ONLY on a real event: the delta TRAVELs in
 * as a small labeled amount that merges, the digits settle with one LIGHT
 * pass, and then it rests. No idle odometer, no perpetual tick-up — a
 * counter that moves when nothing happened is a lie in the persona's eyes.
 *
 * The value arrives preformatted (the data layer owns arithmetic and
 * formatting). On first render it is simply, statically, the number.
 */

import { useEffect, useRef, useState } from 'react';
import { DigitSlide } from './digit-slide';

export interface SettledCounterProps {
  /** Preformatted value, e.g. "128.4". */
  value: string;
  /** Unit rendered after the digits, e.g. "SOL". */
  unit?: string;
  label: string;
  /** The delta chip's text when the value grows (e.g. "+0.88 SOL"). */
  deltaText?: (previous: string, next: string) => string | null;
  className?: string;
}

export function SettledCounter({ value, unit, label, deltaText, className = '' }: SettledCounterProps) {
  const prevRef = useRef(value);
  const [delta, setDelta] = useState<string | null>(null);
  const [passKey, setPassKey] = useState(0);

  useEffect(() => {
    const prev = prevRef.current;
    if (value === prev) return;
    prevRef.current = value;
    // A real event: show the labeled delta merging in, then one LIGHT pass.
    setDelta(deltaText ? deltaText(prev, value) : null);
    setPassKey((k) => k + 1);
    const t = setTimeout(() => setDelta(null), 1400);
    return () => clearTimeout(t);
  }, [value, deltaText]);

  return (
    <div className={`relative flex flex-col gap-1 ${className}`}>
      <span className="text-[13px] text-ink-muted">{label}</span>
      <span className="relative inline-flex items-baseline gap-2 overflow-hidden">
        <span className="tnum font-display text-[34px] font-bold leading-[38px] text-ink">
          <DigitSlide value={value} label={`${label}: ${value}${unit ? ` ${unit}` : ''}`} />
        </span>
        {unit ? <span className="text-[15px] text-ink-muted">{unit}</span> : null}
        {/* One LIGHT pass over the digits when a real event lands. */}
        {passKey > 0 ? (
          <span key={passKey} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <span className="animate-light-pass absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-brand-hot/25 to-transparent" />
          </span>
        ) : null}
      </span>
      {/* The labeled delta, merging in (WARMTH's polite cousin: micro). */}
      {delta ? (
        <span aria-hidden className="warmth-riser absolute -top-2 right-0 text-[13px] font-medium text-ink-muted">
          {delta}
        </span>
      ) : null}
    </div>
  );
}
