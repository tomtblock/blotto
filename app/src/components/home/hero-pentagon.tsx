'use client';

/*
 * The landing page's self-playing allocation demo (founder ask 2026-08-28:
 * a more dynamic, more informational homepage). An SVG pentagon morphs
 * between example allocations so a visitor SEES the core mechanic — five
 * stats, one hundred points, tradeoffs — before reading a word.
 *
 * Motion rules this deliberately honours:
 *   - HYDRATION RULE (see ui/countdown.tsx): the first render is
 *     deterministic — the first example allocation, statically. Animation
 *     starts only in an effect after mount.
 *   - prefers-reduced-motion: the media query is checked directly; reduced
 *     means NO cycling at all — a static diagram, not a faster one.
 *   - This is an explainer diagram in the how-it-works section, never
 *     adjacent to a payment control, and it never flashes: morphs run at
 *     the design system's glide easing over 700ms, far below any
 *     photosensitivity threshold (WCAG 2.3.1).
 *
 * PHASE-D2-REVIEW: a perpetual demo loop is new motion vocabulary (the D1
 * set is one-shot by design; animate-rotate's spinner is the precedent for
 * a looping informational exception). Recorded in the change's PR.
 */

import { useEffect, useRef, useState } from 'react';
import { STAT_NAMES, type Allocation } from '@/battle/allocation';
import { motion } from '@/design/tokens';
import { AXES, axisUnit, pointFor, polygonPoints } from '@/battle/geometry';

/* 360 leaves margin for the corner labels ("Durability" is the widest) —
 * at 320 the lower-left label clipped at the viewBox edge. */
const SIZE = 360;
const R = 118;
const CX = SIZE / 2;
const CY = SIZE / 2;

/* Example allocations, each summing to exactly 100 — the invariant the
 * program enforces, so the demo never shows an impossible entry. */
const EXAMPLES: readonly Allocation[] = [
  [20, 20, 20, 20, 20],
  [45, 25, 10, 10, 10],
  [5, 15, 40, 35, 5],
  [10, 40, 10, 5, 35],
  [30, 5, 25, 10, 30],
];

const HOLD_MS = 2600;

/*
 * Largest-remainder rounding: the interpolated floats sum to exactly 100
 * (both endpoints do), so the DISPLAYED integers must too — the demo never
 * shows numbers that violate the allocation invariant, even mid-morph.
 */
function roundedTo100(values: Allocation): number[] {
  const floors = values.map(Math.floor);
  let remainder = 100 - floors.reduce((a, b) => a + b, 0);
  const order = values
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors;
}

/** rAF ease between two allocations over the design system's glide curve. */
function useMorphingAllocation(): Allocation {
  const [display, setDisplay] = useState<Allocation>(EXAMPLES[0]);
  const state = useRef({ from: EXAMPLES[0], to: EXAMPLES[0], start: 0 });

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let next = 1;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout>;

    const ease = (t: number) => 1 - Math.pow(1 - t, 3); // ≈ the glide curve
    const step = (now: number) => {
      const { from, to, start } = state.current;
      const t = Math.min(1, (now - start) / motion.duration.reveal);
      const e = ease(t);
      setDisplay(
        from.map((v, i) => v + (to[i] - v) * e) as unknown as Allocation
      );
      if (t < 1) raf = requestAnimationFrame(step);
      else timer = setTimeout(advance, HOLD_MS);
    };
    const advance = () => {
      state.current = {
        from: state.current.to,
        to: EXAMPLES[next % EXAMPLES.length],
        start: performance.now(),
      };
      next += 1;
      raf = requestAnimationFrame(step);
    };

    timer = setTimeout(advance, HOLD_MS);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, []);

  return display;
}

export function HeroPentagon({ caption }: { caption: string }) {
  const display = useMorphingAllocation();
  const shown = roundedTo100(display);

  return (
    <figure className="flex flex-col items-center gap-3">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full max-w-[320px]"
        role="img"
        aria-label={caption}
      >
        {/* Grid rings + axes, static. */}
        {[0.33, 0.66, 1].map((f) => (
          <polygon
            key={f}
            points={polygonPoints([100 * f, 100 * f, 100 * f, 100 * f, 100 * f], R, CX, CY)}
            fill="none"
            stroke="var(--color-line)"
            strokeWidth="1"
          />
        ))}
        {Array.from({ length: AXES }, (_, i) => {
          const u = axisUnit(i);
          return (
            <line
              key={i}
              x1={CX}
              y1={CY}
              x2={CX + u.x * R}
              y2={CY + u.y * R}
              stroke="var(--color-line)"
              strokeWidth="1"
            />
          );
        })}

        {/* The live allocation. */}
        <polygon
          points={polygonPoints(display, R, CX, CY)}
          fill="color-mix(in srgb, var(--color-brand) 22%, transparent)"
          stroke="var(--color-brand)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {display.map((v, i) => {
          const p = pointFor(v, i, R);
          return (
            <circle
              key={i}
              cx={CX + p.x}
              cy={CY + p.y}
              r="4"
              fill="var(--color-brand)"
            />
          );
        })}

        {/* Stat labels + the morphing values. */}
        {STAT_NAMES.map((name, i) => {
          const u = axisUnit(i);
          const lx = CX + u.x * (R + 24);
          const ly = CY + u.y * (R + 24);
          return (
            <text
              key={name}
              x={lx}
              y={ly}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-(--color-ink-muted)"
              fontSize="11"
              style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}
            >
              {name}
              <tspan
                x={lx}
                dy="13"
                fontSize="13"
                fontWeight="700"
                className="fill-(--color-ink) tnum"
              >
                {shown[i]}
              </tspan>
            </text>
          );
        })}
      </svg>
      <figcaption className="max-w-[36ch] text-center text-[13px] leading-5 text-ink-muted">
        {caption}
      </figcaption>
    </figure>
  );
}
