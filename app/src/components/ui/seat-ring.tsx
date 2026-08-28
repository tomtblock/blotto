'use client';

/*
 * SeatRing (UI constitution PART 5.3) — the 64-segment ring used at every
 * size: lobby hero, landing Act III, waiting screen, profile-footer
 * miniature. The room's heartbeat, and everything about it is REAL:
 *
 *   - Occupancy binds to on-chain data only. No seeding, no rounding up.
 *   - Per real entry: the new segment fills with a 250ms ease-out sweep, a
 *     single luminance pass (LIGHT) travels once around the already-filled
 *     arc, the counter increments with a single-digit slide, and an
 *     optional "+1 entered" WARMTH riser fades up and out. One pulse per
 *     event, ever.
 *   - The resting glow (WARMTH) scales with true occupancy — a nearly-full
 *     pool feels warm — and never blinks or loops. It uses the brand
 *     floodlight hue: prize amber is reserved for paid amounts, so the
 *     warmth of presence is the arena's light, not the prize's.
 *   - A seat filling announces itself politely (aria-live), not
 *     assertively.
 *
 * Reduced motion: no sweep, no pass, no riser — the ring simply shows the
 * correct fill and glow (WARMTH static at correct intensity).
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { COPY } from '@/copy';
import { motion } from '@/design/tokens';
import { usePrefersReducedMotion } from '@/reveal/stages/use-reduced-motion';
import { DigitSlide } from './digit-slide';

export const SEATS = 64;

/* ViewBox geometry, size-independent. */
const VB = 100;
const C = VB / 2;
const RADIUS = 44;
const STROKE = 5;
const GAP_DEG = 1.6;
const SEG_DEG = 360 / SEATS;

function polar(deg: number, r: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180; // 0° at 12 o'clock, clockwise
  return [C + r * Math.cos(rad), C + r * Math.sin(rad)];
}

function arcPath(i: number): string {
  const a0 = i * SEG_DEG + GAP_DEG / 2;
  const a1 = (i + 1) * SEG_DEG - GAP_DEG / 2;
  const [x0, y0] = polar(a0, RADIUS);
  const [x1, y1] = polar(a1, RADIUS);
  return `M ${x0.toFixed(3)} ${y0.toFixed(3)} A ${RADIUS} ${RADIUS} 0 0 1 ${x1.toFixed(3)} ${y1.toFixed(3)}`;
}

const SEGMENTS = Array.from({ length: SEATS }, (_, i) => arcPath(i));

export interface SeatRingProps {
  /** Real entrants, 0..64 — on-chain occupancy only. */
  entrants: number;
  /** Rendered size in px (the SVG scales; geometry is size-independent). */
  size?: number;
  /** Your seat index (0-based) — held slightly brighter while waiting. */
  yourSeat?: number | null;
  /** Show the "+1 entered" riser on increments (lobby/landing door). */
  riser?: boolean;
  /** Center content; defaults to the "n / 64" counter with digit slides. */
  children?: ReactNode;
  className?: string;
}

export function SeatRing({
  entrants,
  size = 220,
  yourSeat = null,
  riser = false,
  children,
  className = '',
}: SeatRingProps) {
  const clamped = Math.max(0, Math.min(SEATS, entrants));
  const reduced = usePrefersReducedMotion();
  const passRef = useRef<SVGGElement | null>(null);
  const prevRef = useRef(clamped);
  /* Segments that arrived during this mount, for the fill sweep; and a
   * riser instance per real event. */
  const [freshFrom, setFreshFrom] = useState<number | null>(null);
  const [riserKey, setRiserKey] = useState(0);

  useEffect(() => {
    const prev = prevRef.current;
    if (clamped === prev) return;
    prevRef.current = clamped;
    if (clamped < prev) {
      // Refund path: seats empty without ceremony.
      setFreshFrom(null);
      return;
    }
    if (reduced) return;

    setFreshFrom(prev);
    if (riser) setRiserKey((k) => k + 1);

    // The LIGHT pass: one luminance sweep around the already-filled arc.
    const el = passRef.current;
    if (el && clamped > 0) {
      const endDeg = clamped * SEG_DEG;
      el.animate(
        [
          { transform: 'rotate(0deg)', opacity: 0 },
          { opacity: 0.9, offset: 0.15 },
          { opacity: 0.9, offset: 0.85 },
          { transform: `rotate(${endDeg}deg)`, opacity: 0 },
        ],
        { duration: 600, easing: motion.easing.out, fill: 'both' }
      );
    }
  }, [clamped, reduced, riser]);

  const warmthLevel = clamped / SEATS;

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      {/* WARMTH: static resting glow, intensity = real occupancy. */}
      <div
        aria-hidden
        className="warmth-glow pointer-events-none absolute inset-[6%] rounded-full"
        style={
          {
            '--warmth': warmthLevel,
            background:
              'radial-gradient(closest-side, color-mix(in srgb, var(--color-brand) 22%, transparent), transparent 78%)',
          } as React.CSSProperties
        }
      />

      <svg
        viewBox={`0 0 ${VB} ${VB}`}
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label={COPY.proof.seatsFilled(clamped)}
      >
        {SEGMENTS.map((d, i) => {
          const filled = i < clamped;
          const isFresh = freshFrom !== null && i >= freshFrom && i < clamped && !reduced;
          const isYou = yourSeat !== null && i === yourSeat;
          return (
            <path
              key={i}
              d={d}
              pathLength={1}
              fill="none"
              strokeLinecap="round"
              strokeWidth={STROKE}
              className={isFresh ? 'seat-fill' : undefined}
              stroke={
                filled
                  ? isYou
                    ? 'var(--color-brand-hot)'
                    : 'var(--color-brand)'
                  : 'var(--color-overlay)'
              }
              opacity={filled ? (isYou ? 1 : 0.92) : 1}
            />
          );
        })}

        {/* The LIGHT pass overlay: a short bright arc rotated once around
            the filled range by WAAPI. Hidden at rest (opacity 0). */}
        <g ref={passRef} opacity={0} style={{ transformOrigin: '50% 50%' }} aria-hidden>
          <path
            d={SEGMENTS[0]}
            pathLength={1}
            fill="none"
            strokeLinecap="round"
            strokeWidth={STROKE}
            stroke="var(--color-brand-hot)"
          />
        </g>
      </svg>

      {/* Center content. */}
      <div className="relative flex flex-col items-center justify-center text-center">
        {children ?? (
          <>
            <span className="font-display font-bold text-ink" style={{ fontSize: size * 0.16, lineHeight: 1.1 }}>
              <DigitSlide value={String(clamped)} label={COPY.pool.entrantsOf(clamped)} />
              <span className="text-ink-muted"> / {SEATS}</span>
            </span>
            <span className="text-ink-muted" style={{ fontSize: Math.max(11, size * 0.055) }}>
              entered
            </span>
          </>
        )}
      </div>

      {/* Polite announcement of real fill events. */}
      <div aria-live="polite" className="sr-only">
        {COPY.pool.entrantsOf(clamped)}
      </div>

      {/* "+1 entered" WARMTH riser — one per real event. */}
      {riser && riserKey > 0 && !reduced ? (
        <span
          key={riserKey}
          aria-hidden
          className="warmth-riser absolute -top-1 left-1/2 -translate-x-1/2 text-[12px] font-medium text-brand-hot"
        >
          {COPY.proof.riser}
        </span>
      ) : null}
    </div>
  );
}
