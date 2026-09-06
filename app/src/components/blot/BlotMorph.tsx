'use client';

/*
 * <BlotMorph /> — The Blot: one glossy, softly inflated yellow vinyl
 * creature whose five corners are bound one-to-one to the five stats
 * (architect brief "BlotMorph + StatDials"). One shape, always: the body
 * is a single continuous Bézier outline recomputed from the (animated)
 * allocation every frame. No sprite swap, no cross-fade, no path-string
 * tween — those are forbidden by the brief (§10) because any of them can
 * produce a cut, and the whole brand hangs on there never being one.
 *
 * The allocation is the ONLY input to the visual: same allocation →
 * pixel-identical Blot (lock-in stills are reproducible; geometry is
 * unit-tested in blotGeometry.test.ts).
 *
 * Motion budget (brief §3): springs live on the five allocation values
 * (useBlotSprings), never on paths. Idle "breathe" modulates puff ±3%
 * over 4 s — brand surfaces only, NEVER inside the battle card while the
 * clock runs (callers choose the mood; `focused` has zero self-motion).
 * `locked` fires one heart pulse and one visor blink (CSS, one-shot);
 * `paid` raises one arm once. Nothing shakes, nothing flashes, nothing
 * loops in the game card. Reduced motion collapses everything to stills.
 *
 * Two-layer rule: the Blot never shares a frame with a paid amount or a
 * stat number that is not its own dial. This component renders no text.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { STAT_NAMES, type Allocation } from '@/battle/allocation';
import { palette } from '@/design/tokens';
import { BASE_RADIUS, blotScene, UNIT } from './blotGeometry';
import { useBlotSprings, usePrefersReducedMotion } from './springs';
import './blot.css';

export type BlotMood = 'idle' | 'focused' | 'locked' | 'paid';

export interface BlotMorphProps {
  /** The target allocation (five integers summing to 100). */
  allocation: Allocation;
  /** Rendered square size in CSS px. */
  size: number;
  /** idle = brand surfaces; focused = battle (no self-motion). */
  mood?: BlotMood;
  /**
   * When the caller runs the springs itself (the battle screen shares one
   * spring state between the body and the dial knobs), pass the animated
   * values here and the component renders them verbatim.
   */
  display?: readonly number[];
  /** Per-stat velocities (with `display`) — drives the visor drag tilt. */
  velocity?: readonly number[];
  /** Pointer currently down on a dial: heart glow +10%, visor tilts. */
  dragStat?: number | null;
  /** Force-disable animation (defaults to prefers-reduced-motion). */
  reduceMotion?: boolean;
  className?: string;
}

/** The accessible one-liner (brief §7) — exported for reuse in stills UI. */
export function blotAriaLabel(allocation: Allocation): string {
  return `Your Blot: ${allocation.map((v, i) => `${STAT_NAMES[i]} ${v}`).join(', ')}`;
}

/** Screen-reader announcements, throttled to once per second (brief §7). */
function useThrottledLabel(label: string): string {
  const [announced, setAnnounced] = useState(label);
  const lastAt = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const now = Date.now();
    const since = now - lastAt.current;
    if (since >= 1000) {
      lastAt.current = now;
      setAnnounced(label);
    } else {
      if (pending.current) clearTimeout(pending.current);
      pending.current = setTimeout(() => {
        lastAt.current = Date.now();
        setAnnounced(label);
      }, 1000 - since);
    }
    return () => {
      if (pending.current) clearTimeout(pending.current);
    };
  }, [label]);
  return announced;
}

export function BlotMorph({
  allocation,
  size,
  mood = 'idle',
  display,
  velocity,
  dragStat = null,
  reduceMotion,
  className,
}: BlotMorphProps) {
  const prefersReduced = usePrefersReducedMotion();
  const reduced = reduceMotion ?? prefersReduced;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');

  // Internal springs when the caller has not lifted them out.
  const springs = useBlotSprings(allocation, reduced || display !== undefined);
  const shown = display ?? springs.display;
  const vels = velocity ?? springs.velocity;

  /* Idle breathe: ±3% on puff, 4 s sine — brand surfaces only. */
  const [breathePhase, setBreathePhase] = useState(0);
  useEffect(() => {
    if (mood !== 'idle' || reduced) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setBreathePhase(((now - start) % 4000) / 4000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mood, reduced]);
  const puffScale =
    mood === 'idle' && !reduced ? 1 + 0.03 * Math.sin(breathePhase * 2 * Math.PI) : 1;

  const scene = useMemo(() => blotScene(shown, puffScale), [shown, puffScale]);

  /* Visor tilt toward the corner being pulled: ±6° · clamp(velocity).
   * Horizontal lean only — the top corner (Strength) pulls straight up,
   * so its tilt is zero by construction. */
  let visorTilt = 0;
  if (dragStat !== null && dragStat >= 0 && dragStat < 5 && !reduced) {
    const lean = Math.cos(((-90 + dragStat * 72) * Math.PI) / 180);
    visorTilt = 6 * Math.max(-1, Math.min(1, (vels[dragStat] ?? 0) / 150)) * lean;
  }

  const dragging = dragStat !== null;
  const heartR = scene.heart.r * (dragging ? 1.1 : 1);

  const label = blotAriaLabel(allocation);
  const announced = useThrottledLabel(label);

  const legL = scene.legs.left;
  const legR = scene.legs.right;
  const legHL = Math.max(0, scene.legs.bottom - legL.top);
  const legHR = Math.max(0, scene.legs.bottom - legR.top);

  return (
    <div
      className={`blot-root blot-mood-${mood}${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={label}
    >
      <svg
        className="blot-svg"
        width={size}
        height={size}
        viewBox={`0 0 ${UNIT} ${UNIT}`}
        overflow="visible"
        aria-hidden="true"
      >
        <defs>
          {/* Lit from the top-left: the vinyl's radial body gradient. */}
          <radialGradient id={`${uid}-body`} cx="32%" cy="28%" r="85%">
            <stop offset="0%" stopColor={palette.blotLit} />
            <stop offset="45%" stopColor={palette.brandYellow} />
            <stop offset="100%" stopColor={palette.blotShade} />
          </radialGradient>
          {/* Rim light, masked to the upper-left by the gradient itself. */}
          <linearGradient id={`${uid}-rim`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={palette.blotRim} stopOpacity="0.55" />
            <stop offset="55%" stopColor={palette.blotRim} stopOpacity="0" />
          </linearGradient>
          {/* Ambient occlusion: transparent centre, warm shade at the edge. */}
          <radialGradient id={`${uid}-ao`} cx="50%" cy="50%" r="72%">
            <stop offset="0%" stopColor={palette.blotAmbient} stopOpacity="0" />
            <stop offset="78%" stopColor={palette.blotAmbient} stopOpacity="0" />
            <stop offset="100%" stopColor={palette.blotAmbient} stopOpacity="0.18" />
          </radialGradient>
          <linearGradient id={`${uid}-limb`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={palette.brandYellow} />
            <stop offset="100%" stopColor={palette.blotShade} />
          </linearGradient>
          {/* Tight, fixed filter regions: never recreated per frame. */}
          <filter
            id={`${uid}-shadow-blur`}
            filterUnits="userSpaceOnUse"
            x="-200"
            y={UNIT - 300}
            width={UNIT + 400}
            height="500"
          >
            <feGaussianBlur stdDeviation="22" />
          </filter>
          <filter
            id={`${uid}-heart-blur`}
            filterUnits="userSpaceOnUse"
            x="200"
            y="200"
            width="600"
            height="600"
          >
            <feGaussianBlur stdDeviation="18" />
          </filter>
          <filter
            id={`${uid}-spec-blur`}
            filterUnits="userSpaceOnUse"
            x="-400"
            y="-400"
            width={UNIT + 800}
            height={UNIT + 800}
          >
            <feGaussianBlur stdDeviation="14" />
          </filter>
        </defs>

        <g
          transform={
            scene.fit < 1
              ? `translate(500 480) scale(${scene.fit.toFixed(4)}) translate(-500 -480)`
              : undefined
          }
        >
        {/* Floor shadow — the Blot stands on something. */}
        <ellipse
          cx={scene.shadow.cx}
          cy={scene.shadow.cy}
          rx={scene.shadow.rx}
          ry={scene.shadow.ry}
          fill={palette.blotShadow}
          opacity="0.35"
          filter={`url(#${uid}-shadow-blur)`}
        />

        {/* Legs: capsules from the live outline down to the ground line. */}
        {legHL > 0 && (
          <rect
            x={legL.x - scene.legs.width / 2}
            y={legL.top}
            width={scene.legs.width}
            height={legHL}
            rx={Math.min(scene.legs.rx, legHL / 2)}
            fill={`url(#${uid}-limb)`}
          />
        )}
        {legHR > 0 && (
          <rect
            x={legR.x - scene.legs.width / 2}
            y={legR.top}
            width={scene.legs.width}
            height={legHR}
            rx={Math.min(scene.legs.rx, legHR / 2)}
            fill={`url(#${uid}-limb)`}
          />
        )}

        {/* Arms: capsules anchored to the live outline, rotated away. */}
        <rect
          className="blot-arm-left"
          x={scene.arms.left.x - scene.arms.width / 2}
          y={scene.arms.left.y}
          width={scene.arms.width}
          height={scene.arms.length}
          rx={scene.arms.rx}
          fill={`url(#${uid}-limb)`}
          transform={`rotate(${scene.arms.left.angle} ${scene.arms.left.x} ${scene.arms.left.y})`}
        />
        <rect
          className="blot-arm-right"
          x={scene.arms.right.x - scene.arms.width / 2}
          y={scene.arms.right.y}
          width={scene.arms.width}
          height={scene.arms.length}
          rx={scene.arms.rx}
          fill={`url(#${uid}-limb)`}
          transform={`rotate(${scene.arms.right.angle} ${scene.arms.right.x} ${scene.arms.right.y})`}
        />

        {/* THE BODY — one continuous inflated outline. */}
        <g className="blot-body">
          <path d={scene.bodyPath} fill={`url(#${uid}-body)`} />
          {/* Ambient occlusion overlay. */}
          <path d={scene.bodyPath} fill={`url(#${uid}-ao)`} />
          {/* Rim light on the lit side. */}
          <path
            d={scene.bodyPath}
            fill="none"
            stroke={`url(#${uid}-rim)`}
            strokeWidth="10"
            strokeLinejoin="round"
          />
          {/* Stitched vinyl seam. */}
          <path
            d={scene.seamPath}
            fill="none"
            stroke={palette.blotSeam}
            strokeWidth="3"
            opacity="0.8"
          />
        </g>

        {/* Heart glow: blurred halo under a sharp core. */}
        <g className="blot-heart">
          <circle
            cx={scene.heart.cx}
            cy={scene.heart.cy}
            r={heartR * 1.35}
            fill={palette.blotHeart}
            opacity="0.45"
            filter={`url(#${uid}-heart-blur)`}
          />
          <circle cx={scene.heart.cx} cy={scene.heart.cy} r={heartR} fill={palette.blotHeart} opacity="0.6" />
        </g>

        {/* Visor — fixed size, clamped inside the outline, tilts on drag. */}
        <g
          className="blot-visor"
          transform={visorTilt !== 0 ? `rotate(${visorTilt.toFixed(2)} ${scene.visor.cx} ${scene.visor.cy})` : undefined}
        >
          <rect
            x={scene.visor.cx - scene.visor.width / 2}
            y={scene.visor.cy - scene.visor.height / 2}
            width={scene.visor.width}
            height={scene.visor.height}
            rx={scene.visor.rx}
            fill={palette.blotVisor}
          />
          {/* Specular line along the visor's top edge. */}
          <rect
            x={scene.visor.cx - scene.visor.width / 2 + scene.visor.rx}
            y={scene.visor.cy - scene.visor.height / 2 + 8}
            width={Math.max(0, scene.visor.width - scene.visor.rx * 2)}
            height="6"
            rx="3"
            fill={palette.brandCream}
            opacity="0.45"
          />
        </g>

        {/* Body specular — slides with the corners' centroid. */}
        <ellipse
          cx={scene.specular.cx}
          cy={scene.specular.cy}
          rx={scene.specular.rx}
          ry={scene.specular.ry}
          fill={palette.brandCream}
          opacity="0.32"
          filter={`url(#${uid}-spec-blur)`}
        />
        </g>
      </svg>
      <span className="sr-only" aria-live="polite">
        {announced}
      </span>
    </div>
  );
}

/* Kept for callers sizing stages around the Blot. */
export const BLOT_BASE_RADIUS_FRACTION = BASE_RADIUS / UNIT;
