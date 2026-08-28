'use client';

/*
 * The pentagon radar (PID §4.2; UI constitution 6.4) — the allocation
 * instrument. Five draggable vertices on fixed axes; the DISPLAYED polygon
 * is always the machine's normalised integers, the drag writes raw values
 * through `onDrag`, and the machine feeds the display back down. No
 * presets, no snapping, no chips, no ghost shapes — see
 * src/battle/allocation.ts's header for why that is a rule, not taste.
 *
 * The charge moment:
 *   - Vertex grab: the vertex scales up slightly and gains a soft halo;
 *     the shape follows the thumb 1:1 (gesture-driven values track the
 *     finger directly — the spring belongs to the release, not the drag).
 *   - Charging feedback: the active axis brightens and 3 tiny light
 *     particles drift up it toward the vertex while the value RISES; a
 *     falling value simply dims the axis. Intensity tracks RATE OF CHANGE,
 *     never the value reached (hard constraint 4 — motion celebrates the
 *     act of allocating and is indifferent to the values chosen).
 *   - Live normalisation: the five integers re-flow with per-digit
 *     crossfades — arithmetic made visible, never a counter to chase. The
 *     actively-dragged stat renders plainly (it changes every frame; a
 *     crossfade would thrash), the re-balancing stats crossfade.
 *   - Release: one small spring overshoot into a grounded settle — the
 *     site's single sanctioned overshoot, only ever after a gesture.
 *
 * Keyboard path (PART 4.3): the instrument is one focusable stop.
 * Left/Right select a vertex, Up/Down nudge its value by 1 (PageUp/Down
 * by 5), with the identical normalisation and the identical charge
 * feedback; changes announce politely. Focus wears the LIGHT outline from
 * the global stylesheet — statically, since keyboard actions never
 * animate positionally.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { COPY } from '@/copy';
import { STAT_NAMES, type Allocation } from '../allocation';
import { AXES, axisUnit, pointFor, polygonPoints, valueForPointer } from '../geometry';
import { DigitSlide } from '@/components/ui/digit-slide';
import { usePrefersReducedMotion } from '@/design/use-reduced-motion';

const SIZE = 360;
const R = 150;
const CX = SIZE / 2;
const CY = SIZE / 2;

/** Axis angle in degrees for CSS rotation (0° = +x). */
const AXIS_DEG = Array.from({ length: AXES }, (_, i) => -90 + i * 72);

interface Charge {
  stat: number;
  /** 0..1 — from the magnitude of recent change. */
  level: number;
  /** +1 rising (particles), -1 falling (dim). */
  dir: 1 | -1;
}

export interface PentagonRadarProps {
  display: Allocation;
  /** Raw drag write: (stat, rawValue 0..100). */
  onDrag: (stat: number, value: number) => void;
  disabled?: boolean;
}

export function PentagonRadar({ display, onDrag, disabled }: PentagonRadarProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragging = useRef<number | null>(null);
  const reduced = usePrefersReducedMotion();

  /* The keyboard cursor; also the vertex that wears the halo while a
   * pointer drags. */
  const [activeStat, setActiveStat] = useState<number | null>(null);
  const [charge, setCharge] = useState<Charge | null>(null);
  const chargeDecay = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Re-keyed on pointer release to play the settle once. */
  const [settleKey, setSettleKey] = useState(0);
  /* True while a pointer drag is live (state mirror of the ref, for
   * render-time decisions — refs are not read during render). */
  const [pointerActive, setPointerActive] = useState(false);
  /* Polite announcement for keyboard-driven changes only. */
  const [announce, setAnnounce] = useState('');

  const feedCharge = useCallback((stat: number, from: number, to: number) => {
    const delta = to - from;
    if (delta === 0) return;
    const level = Math.min(1, Math.abs(delta) / 3);
    setCharge((prev) => ({
      stat,
      dir: delta > 0 ? 1 : -1,
      level: prev && prev.stat === stat ? Math.max(level, prev.level * 0.85) : level,
    }));
    if (chargeDecay.current) clearTimeout(chargeDecay.current);
    chargeDecay.current = setTimeout(() => setCharge(null), 180);
  }, []);

  useEffect(
    () => () => {
      if (chargeDecay.current) clearTimeout(chargeDecay.current);
    },
    []
  );

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
      const stat = dragging.current;
      const next = pointerValue(e, stat);
      feedCharge(stat, display[stat], next);
      onDrag(stat, next);
    },
    [onDrag, pointerValue, disabled, display, feedCharge]
  );

  const endDrag = useCallback(() => {
    if (dragging.current === null) return;
    dragging.current = null;
    setPointerActive(false);
    setActiveStat(null);
    // Release: the one sanctioned spring settle.
    if (!reduced) setSettleKey((k) => k + 1);
  }, [reduced]);

  const nudge = useCallback(
    (stat: number, delta: number) => {
      const next = Math.max(0, Math.min(100, display[stat] + delta));
      feedCharge(stat, display[stat], next);
      onDrag(stat, next);
      setAnnounce(`${STAT_NAMES[stat]} ${next}`);
    },
    [display, onDrag, feedCharge]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      const stat = activeStat ?? 0;
      switch (e.key) {
        case 'ArrowLeft':
          setActiveStat((stat + AXES - 1) % AXES);
          setAnnounce(`${STAT_NAMES[(stat + AXES - 1) % AXES]} selected`);
          break;
        case 'ArrowRight':
          setActiveStat((stat + 1) % AXES);
          setAnnounce(`${STAT_NAMES[(stat + 1) % AXES]} selected`);
          break;
        case 'ArrowUp':
          setActiveStat(stat);
          nudge(stat, 1);
          break;
        case 'ArrowDown':
          setActiveStat(stat);
          nudge(stat, -1);
          break;
        case 'PageUp':
          setActiveStat(stat);
          nudge(stat, 5);
          break;
        case 'PageDown':
          setActiveStat(stat);
          nudge(stat, -5);
          break;
        default:
          return;
      }
      e.preventDefault();
    },
    [activeStat, disabled, nudge]
  );


  return (
    <div className="flex flex-col items-center gap-4">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full max-w-[360px] touch-none select-none rounded-2xl"
        onPointerMove={handleMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        role="application"
        aria-label={`Battle allocation. ${COPY.battle.statNames.join(', ')}. Left and right arrows select a stat, up and down adjust it; the five values always total 100.`}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={onKeyDown}
        onBlur={() => setActiveStat(null)}
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
          const charging = charge !== null && charge.stat === i;
          /* Rate-of-change feedback: rising brightens the axis, falling
           * dims it. Never tied to the value itself. */
          const axisOpacity = charging
            ? charge.dir > 0
              ? 0.35 + 0.5 * charge.level
              : 0.2
            : 0.35;
          return (
            <line
              key={i}
              x1={CX}
              y1={CY}
              x2={CX + u.x * R}
              y2={CY + u.y * R}
              stroke={charging && charge.dir > 0 ? 'var(--color-brand)' : 'var(--color-line)'}
              strokeWidth={charging && charge.dir > 0 ? 1.5 : 1}
              opacity={axisOpacity}
            />
          );
        })}

        {/* Charge particles: a quiet charge, only while a value rises. */}
        {!reduced && charge && charge.dir > 0 && charge.level > 0.08 ? (
          <g
            transform={`translate(${CX} ${CY}) rotate(${AXIS_DEG[charge.stat]})`}
            aria-hidden
          >
            {[0, 1, 2].map((k) => (
              <circle
                key={k}
                r={1.8}
                cy={(k - 1) * 3}
                fill="var(--color-brand-hot)"
                className="charge-particle"
                style={
                  {
                    '--charge': String(0.35 + 0.55 * charge.level),
                    animationDelay: `${-k * 200}ms`,
                  } as React.CSSProperties
                }
              />
            ))}
          </g>
        ) : null}

        {/* The real allocation. Re-keyed on release for the settle. */}
        <g
          key={settleKey}
          className={settleKey > 0 ? 'pentagon-settle' : undefined}
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        >
          <polygon
            points={polygonPoints(display as unknown as number[], R, CX, CY)}
            fill="var(--color-brand)"
            fillOpacity={0.25}
            stroke="var(--color-brand)"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          {/* Vertex handles */}
          {display.map((v, i) => {
            const p = pointFor(v, i, R);
            const active = activeStat === i;
            return (
              <g key={i}>
                {/* Soft halo on the grabbed / selected vertex. */}
                {active ? (
                  <circle
                    cx={CX + p.x}
                    cy={CY + p.y}
                    r={13}
                    fill="var(--color-brand)"
                    opacity={0.22}
                    pointerEvents="none"
                  />
                ) : null}
                <circle
                  cx={CX + p.x}
                  cy={CY + p.y}
                  r={14}
                  fill="transparent"
                  className={disabled ? '' : 'cursor-grab'}
                  onPointerDown={(e) => {
                    if (disabled) return;
                    dragging.current = i;
                    setPointerActive(true);
                    setActiveStat(i);
                    (e.target as Element).setPointerCapture(e.pointerId);
                    const next = pointerValue(e, i);
                    feedCharge(i, display[i], next);
                    onDrag(i, next);
                  }}
                />
                <circle
                  cx={CX + p.x}
                  cy={CY + p.y}
                  r={active ? 7.5 : 6}
                  fill={active ? 'var(--color-brand-hot)' : 'var(--color-brand)'}
                  pointerEvents="none"
                />
              </g>
            );
          })}
        </g>

        {/* Stat labels (outside the settle group — labels never move). */}
        {Array.from({ length: AXES }, (_, i) => {
          const u = axisUnit(i);
          return (
            <text
              key={i}
              x={CX + u.x * (R + 18)}
              y={CY + u.y * (R + 18)}
              textAnchor="middle"
              dominantBaseline="middle"
              className="text-[11px] font-medium uppercase tracking-[0.1em]"
              fill={activeStat === i ? 'var(--color-ink)' : 'var(--color-ink-muted)'}
            >
              {STAT_NAMES[i]}
            </text>
          );
        })}
      </svg>

      {/* Keyboard changes announce politely; pointer drags stay silent (the
          shape is the feedback). */}
      <div aria-live="polite" className="sr-only">
        {announce}
      </div>

      {/* Integers under the pentagon — feedback, never targets (PID §4.2).
          Re-balancing stats crossfade per digit (arithmetic made visible);
          the actively-dragged stat renders plainly — it changes every
          frame, and a crossfade against a moving target is noise. */}
      <div className="flex w-full items-end justify-center gap-1">
        <dl className="grid grid-cols-5 gap-4 text-center">
          {display.map((v, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              <dt className="text-[10px] uppercase tracking-[0.12em] text-ink-muted">
                {COPY.battle.statNames[i]}
              </dt>
              <dd className="tnum font-display text-[28px] leading-[30px] font-bold text-ink">
                {pointerActive || reduced ? (
                  String(v)
                ) : (
                  <DigitSlide value={String(v)} label={`${COPY.battle.statNames[i]} ${v}`} />
                )}
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
