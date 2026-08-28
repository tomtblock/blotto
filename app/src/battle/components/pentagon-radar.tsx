'use client';

/*
 * The pentagon radar (PID §4.2) — five draggable vertices, one per stat, on
 * fixed axes. The DISPLAYED polygon is always the real allocation (the
 * machine's normalised integers); the drag writes raw values through the
 * `onDrag` callback and the machine feeds the display back down. No presets,
 * no snapping, no chips — see src/battle/allocation.ts's header for why that
 * is a rule and not a style choice.
 */

import { useCallback, useRef } from 'react';
import { COPY } from '@/copy';
import { STAT_NAMES, type Allocation } from '../allocation';
import { AXES, axisUnit, pointFor, polygonPoints, valueForPointer } from '../geometry';

const SIZE = 360;
const R = 150;
const CX = SIZE / 2;
const CY = SIZE / 2;

export interface PentagonRadarProps {
  display: Allocation;
  /** Raw drag write: (stat, rawValue 0..100). */
  onDrag: (stat: number, value: number) => void;
  disabled?: boolean;
}

export function PentagonRadar({ display, onDrag, disabled }: PentagonRadarProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragging = useRef<number | null>(null);

  const pointerValue = useCallback((e: React.PointerEvent, stat: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const scale = SIZE / rect.width;
    const x = (e.clientX - rect.left) * scale - CX;
    const y = (e.clientY - rect.top) * scale - CY;
    return valueForPointer(x, y, stat, R);
  }, []);

  const handleMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragging.current === null || disabled) return;
      onDrag(dragging.current, pointerValue(e, dragging.current));
    },
    [onDrag, pointerValue, disabled]
  );

  return (
    <div className="flex flex-col items-center gap-4">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full max-w-[360px] touch-none select-none"
        onPointerMove={handleMove}
        onPointerUp={() => (dragging.current = null)}
        onPointerLeave={() => (dragging.current = null)}
        role="group"
        aria-label="battle allocation pentagon"
      >
        {/* Reference rings + axes */}
        {[25, 50, 75, 100].map((v) => (
          <polygon
            key={v}
            points={polygonPoints([v, v, v, v, v], R, CX, CY)}
            fill="none"
            stroke="var(--color-line)"
            strokeWidth={1}
            opacity={0.35}
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
              strokeWidth={1}
              opacity={0.35}
            />
          );
        })}
        {/* The real allocation */}
        <polygon
          points={polygonPoints(display as unknown as number[], R, CX, CY)}
          fill="var(--color-brand)"
          fillOpacity={0.25}
          stroke="var(--color-brand)"
          strokeWidth={2}
        />
        {/* Vertex handles */}
        {display.map((v, i) => {
          const p = pointFor(v, i, R);
          const u = axisUnit(i);
          return (
            <g key={i}>
              <circle
                cx={CX + p.x}
                cy={CY + p.y}
                r={14}
                fill="transparent"
                className={disabled ? '' : 'cursor-grab'}
                onPointerDown={(e) => {
                  if (disabled) return;
                  dragging.current = i;
                  (e.target as Element).setPointerCapture(e.pointerId);
                  onDrag(i, pointerValue(e, i));
                }}
              />
              <circle
                cx={CX + p.x}
                cy={CY + p.y}
                r={6}
                fill="var(--color-brand)"
                pointerEvents="none"
              />
              <text
                x={CX + u.x * (R + 18)}
                y={CY + u.y * (R + 18)}
                textAnchor="middle"
                dominantBaseline="middle"
                className="text-[11px] font-medium uppercase tracking-[0.1em]"
                fill="var(--color-ink-muted)"
              >
                {STAT_NAMES[i]}
              </text>
            </g>
          );
        })}
      </svg>
      {/* Integers under the pentagon — feedback, never targets (PID §4.2).
          These are THE numbers of the session, so they wear the display face
          big; the fixed total states the invariant (five stats, exactly 100). */}
      <div className="flex w-full items-end justify-center gap-1">
        <dl className="grid grid-cols-5 gap-4 text-center">
          {display.map((v, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              <dt className="text-[10px] uppercase tracking-[0.12em] text-ink-muted">
                {COPY.battle.statNames[i]}
              </dt>
              <dd className="tnum font-display text-[28px] leading-[30px] font-bold text-ink">
                {v}
              </dd>
            </div>
          ))}
        </dl>
        <span className="tnum pb-0.5 pl-2 font-display text-[15px] font-semibold text-ink-muted">
          = 100
        </span>
      </div>
    </div>
  );
}
