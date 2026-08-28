'use client';

/*
 * WinnersDrift (UI constitution PART 5.7): a constant slow drift of
 * completed-tournament cards — roughly 24s per viewport width, linear
 * (constant motion), pausing on hover or touch. The speed is fixed by
 * geometry alone: it NEVER loops faster when pools are scarce, because a
 * row that speeds up when the room is quiet is a lie about the room.
 *
 * One WARMTH rise per card entering the viewport, once. Fewer than three
 * cards do not drift at all — a drifting wall of one card is theatre, and
 * the Adjudicator does not pretend. Empty state is stated plainly.
 *
 * Reduced motion: no drift; the cards are a plain scrollable row.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { COPY } from '@/copy';
import { usePrefersReducedMotion } from '@/reveal/stages/use-reduced-motion';

const SECONDS_PER_VIEWPORT = 24;
const MIN_CARDS_TO_DRIFT = 3;

export function WinnersDrift({ cards }: { cards: ReactNode[] }) {
  const reduced = usePrefersReducedMotion();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [durationS, setDurationS] = useState<number | null>(null);
  const [touchPaused, setTouchPaused] = useState(false);

  const drift = !reduced && cards.length >= MIN_CARDS_TO_DRIFT;

  useEffect(() => {
    if (!drift) return;
    const el = trackRef.current;
    if (!el) return;
    // Content width → drift duration at a fixed px/s (viewport-relative),
    // so density never changes speed. The track holds two copies; the
    // animation moves one copy's width (-50%).
    const measure = () => {
      const half = el.scrollWidth / 2;
      const vw = Math.max(1, window.innerWidth);
      setDurationS((half / vw) * SECONDS_PER_VIEWPORT);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [drift, cards.length]);

  if (cards.length === 0) {
    return <p className="text-[14px] text-ink-muted">{COPY.proof.winnersEmpty}</p>;
  }

  if (!drift) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-2" role="list">
        {cards.map((c, i) => (
          <div role="listitem" key={i}>
            <WarmthOnEntry>{c}</WarmthOnEntry>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-hidden" role="list" aria-label={COPY.proof.winnersTitle}>
      <div
        ref={trackRef}
        className="drift-track flex w-max gap-4"
        data-paused={touchPaused ? 'true' : 'false'}
        style={durationS ? ({ '--drift-duration': `${durationS}s` } as React.CSSProperties) : undefined}
        onTouchStart={() => setTouchPaused(true)}
        onTouchEnd={() => setTouchPaused(false)}
        onTouchCancel={() => setTouchPaused(false)}
      >
        {/* Two copies for a seamless -50% loop; the duplicate is decor. */}
        {cards.map((c, i) => (
          <div role="listitem" key={`a-${i}`}>
            <WarmthOnEntry>{c}</WarmthOnEntry>
          </div>
        ))}
        {cards.map((c, i) => (
          <div key={`b-${i}`} aria-hidden>
            {c}
          </div>
        ))}
      </div>
    </div>
  );
}

/** One soft WARMTH rise the first time a card enters the viewport. */
function WarmthOnEntry({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [risen, setRisen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || risen) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          setRisen(true);
        }
      },
      { threshold: 0.6 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [risen]);

  return (
    <div ref={ref} className={risen ? 'animate-warmth-rise' : undefined}>
      {children}
    </div>
  );
}
