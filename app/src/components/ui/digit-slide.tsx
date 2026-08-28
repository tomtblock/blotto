'use client';

/*
 * DigitSlide (UI constitution PART 5.3 / 5.8): a numeric readout whose
 * digits change with a single slide — the old digit exits upward (150ms),
 * the new one enters from below (250ms). Only positions that actually
 * changed move; a value that has not changed is perfectly still. This is
 * the counter discipline behind "n / 64 entered" and the paid-out counter:
 * a counter that moves when nothing happened is a lie.
 *
 * The value is a preformatted string (the data layer owns formatting; this
 * component does zero arithmetic). Always renders `.tnum` so a change
 * never jitters sideways.
 */

import { useState } from 'react';

interface DigitSlideProps {
  value: string;
  className?: string;
  /** Accessible label for the whole readout; digits are aria-hidden. */
  label?: string;
}

export function DigitSlide({ value, className = '', label }: DigitSlideProps) {
  // "Adjusting state when a prop changes" (render-phase update): prev is
  // always the value of the previous render, so back-to-back ticks never
  // animate against a stale outgoing digit.
  const [last, setLast] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== last) {
    setPrev(last);
    setLast(value);
  }

  const chars = [...value];
  const prevChars = [...prev];
  // Align previous characters to the END of the new string so magnitude
  // growth (9 → 10) slides the changed tail, not every digit.
  const offset = chars.length - prevChars.length;

  return (
    <span className={`tnum ${className}`}>
      <span className="sr-only">{label ?? value}</span>
      {chars.map((c, i) => {
        const before = i - offset >= 0 ? prevChars[i - offset] : undefined;
        const changed = before !== undefined ? before !== c : value !== prev;
        return (
          <span key={`${i}-${chars.length}`} className="digit-col" aria-hidden="true">
            {changed && before !== undefined && value !== prev ? (
              <span key={`out-${before}-${value}`} className="digit-out">
                {before}
              </span>
            ) : null}
            <span
              key={`in-${c}-${changed ? value : 'static'}`}
              className={changed && value !== prev ? 'digit-in' : undefined}
            >
              {c}
            </span>
          </span>
        );
      })}
    </span>
  );
}
