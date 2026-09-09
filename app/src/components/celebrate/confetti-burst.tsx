'use client';

/*
 * One confetti burst. Mount it and it plays once, then removes itself from
 * the DOM; the caller decides WHEN (and how often) it deserves to appear —
 * the results page latches it to once-ever per paid result, the battle run
 * plays it once at the seventh lock (founder 2026-09-09: "a big crescendo
 * moment"). Reduced motion renders nothing at all.
 *
 * Pieces are deterministic (index-derived positions and delays) so two
 * mounts look the same and nothing here is random in any sense a player
 * could read into.
 */

import { useEffect, useState } from 'react';
import { usePrefersReducedMotion } from '@/components/blot/springs';
import { palette } from '@/design/tokens';
import './confetti.css';

const COLOURS = [palette.brandYellow, palette.brandPink, palette.brandCream, palette.brandCoral];

export interface ConfettiBurstProps {
  /** Number of pieces (default 26; the crescendo uses more). */
  pieces?: number;
  /** How long the field stays mounted, ms (the fall itself is 1.1 s). */
  durationMs?: number;
  /** Called after the field unmounts. */
  onDone?: () => void;
}

export function ConfettiBurst({ pieces = 26, durationMs = 1200, onDone }: ConfettiBurstProps) {
  const reduced = usePrefersReducedMotion();
  const [alive, setAlive] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setAlive(false);
      onDone?.();
    }, reduced ? 0 : durationMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one timer per mount
  }, []);

  if (!alive || reduced) return null;
  return (
    <div className="confetti-field" aria-hidden="true">
      {Array.from({ length: pieces }, (_, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: `${(i * 37) % 100}%`,
            background: COLOURS[i % COLOURS.length],
            animationDelay: `${(i % 7) * 40 + Math.floor(i / 26) * 180}ms`,
            transform: `rotate(${(i * 53) % 360}deg)`,
          }}
        />
      ))}
    </div>
  );
}
