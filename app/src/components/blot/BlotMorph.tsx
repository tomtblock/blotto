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
 *
 * FACE (founder 2026-09-09): the visor bows into a smile or a wince, two
 * brows tilt and lift, two cheeks blush — all pure geometry off the visor
 * box (expression.ts), chosen by which stat is under the player's hand and
 * which way it is moving, and held for half a second after the hand lifts.
 * At rest the face is REST_EXPRESSION, the one the lock-in still wears.
 * MATERIAL: a diagonal sheen, stitched seam and a hard specular dot make
 * the vinyl read as the Higgsfield renders do. Geometry is unchanged.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { STAT_NAMES, type Allocation } from '@/battle/allocation';
import { palette } from '@/design/tokens';
import { BASE_RADIUS, blotScene, UNIT } from './blotGeometry';
import { useBlotSprings, usePrefersReducedMotion } from './springs';
import { REST_EXPRESSION, brows, cheeks, expressionFor, visorPath, type Expression } from './expression';
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

  /* Visor tilt toward the corner being dragged: ±6° · clamp(velocity).
   * Horizontal lean only — the top corner (Strength) lifts straight up,
   * so its tilt is zero by construction. */
  let visorTilt = 0;
  if (dragStat !== null && dragStat >= 0 && dragStat < 5 && !reduced) {
    const lean = Math.cos(((-90 + dragStat * 72) * Math.PI) / 180);
    visorTilt = 6 * Math.max(-1, Math.min(1, (vels[dragStat] ?? 0) / 150)) * lean;
  }

  const dragging = dragStat !== null;
  const heartR = scene.heart.r * (dragging ? 1.1 : 1);

  /* The face — a pure function of the motion. While a dial is held the
   * expression follows that stat and its direction of travel; when the
   * hand lifts it follows whichever stat is still moving most, so the face
   * relaxes to rest exactly as the springs settle (no timers, no held
   * state). Reduced motion: rest face, always. */
  const face: Expression = useMemo(() => {
    if (reduced) return REST_EXPRESSION;
    let k = dragStat !== null && dragStat >= 0 && dragStat < 5 ? dragStat : -1;
    if (k < 0) {
      let best = 0;
      for (let i = 0; i < 5; i++) {
        const a = Math.abs(vels[i] ?? 0);
        if (a > best) {
          best = a;
          k = i;
        }
      }
      // Below this the springs are settling, not being stretched.
      if (k < 0 || best < 8) return REST_EXPRESSION;
    }
    const v = vels[k] ?? 0;
    const dir = v > 0 ? 1 : v < 0 ? -1 : 0;
    const floor = dragStat !== null ? 0.35 : 0;
    return expressionFor(k, dir, Math.min(1, Math.abs(v) / 120 + floor));
  }, [reduced, dragStat, vels]);
  // The reference toy wears a wider, deeper visor than the geometry's box;
  // the face helpers take the enlarged box so brows and cheeks follow it.
  const visorBox = {
    ...scene.visor,
    width: scene.visor.width * 1.22,
    height: scene.visor.height * 1.32,
    rx: scene.visor.rx * 1.3,
  };
  const browPair = brows(visorBox, face);
  const cheekPair = cheeks(visorBox, face);
  const visorD = visorPath(visorBox, face);

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
          {/* Diagonal sheen: the vinyl's broad soft highlight. */}
          <linearGradient id={`${uid}-sheen`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={palette.brandCream} stopOpacity="0.28" />
            <stop offset="38%" stopColor={palette.brandCream} stopOpacity="0.06" />
            <stop offset="60%" stopColor={palette.brandCream} stopOpacity="0" />
            <stop offset="100%" stopColor={palette.blotAmbient} stopOpacity="0.12" />
          </linearGradient>
          {/* THE MATERIAL (founder 2026-09-09: "far more detailed … like the
              Higgsfield assets"): inflated vinyl. The silhouette's blurred
              alpha is a height map; a point light above-left gives it
              diffuse roundness and a tight specular, so the SAME outline the
              allocation draws reads as a puffed, glossy toy. Region is fixed
              in user space so the filter never re-allocates per frame. */}
          <filter
            id={`${uid}-puff`}
            filterUnits="userSpaceOnUse"
            x="-300"
            y="-300"
            width={UNIT + 600}
            height={UNIT + 600}
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur in="SourceAlpha" stdDeviation="34" result="bump" />
            <feDiffuseLighting in="bump" surfaceScale="16" diffuseConstant="1.05" lightingColor="#ffffff" result="diff">
              <fePointLight x="300" y="120" z="720" />
            </feDiffuseLighting>
            <feComposite in="diff" in2="SourceAlpha" operator="in" result="diffIn" />
            {/* shaded = graphic × (0.42 + 0.58 × diffuse) */}
            <feComposite in="SourceGraphic" in2="diffIn" operator="arithmetic" k1="0.58" k2="0.42" k3="0" k4="0" result="shaded" />
            <feSpecularLighting in="bump" surfaceScale="18" specularConstant="0.9" specularExponent="26" lightingColor={palette.brandCream} result="spec">
              <fePointLight x="280" y="100" z="560" />
            </feSpecularLighting>
            <feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn" />
            <feComposite in="specIn" in2="shaded" operator="arithmetic" k1="0" k2="0.85" k3="1" k4="0" />
          </filter>
          {/* Visor glass: near-black plum, lit along its top. */}
          <linearGradient id={`${uid}-glass`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={palette.blotShade} stopOpacity="0.55" />
            <stop offset="18%" stopColor={palette.blotVisor} />
            <stop offset="100%" stopColor={palette.blotVisor} />
          </linearGradient>
          <linearGradient id={`${uid}-glass-shine`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={palette.brandCream} stopOpacity="0.55" />
            <stop offset="45%" stopColor={palette.brandCream} stopOpacity="0.08" />
            <stop offset="100%" stopColor={palette.brandCream} stopOpacity="0" />
          </linearGradient>
          {/* The heart's glow: a wide soft bloom across the lower face. */}
          <radialGradient id={`${uid}-bloom`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={palette.blotHeart} stopOpacity="0.9" />
            <stop offset="35%" stopColor={palette.blotHeart} stopOpacity="0.5" />
            <stop offset="100%" stopColor={palette.blotHeart} stopOpacity="0" />
          </radialGradient>
          <clipPath id={`${uid}-bodyclip`}>
            <path d={scene.bodyPath} />
          </clipPath>
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

        {/* Everything made of vinyl — limbs and body — is lit as one puffed
            silhouette; the seams, face and glow are drawn crisp on top. */}
        <g filter={`url(#${uid}-puff)`}>
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
          {/* Broad diagonal sheen. */}
          <path d={scene.bodyPath} fill={`url(#${uid}-sheen)`} />
        </g>
        </g>

        {/* Quilted panels: each corner's panel pillows toward the light. */}
        <g clipPath={`url(#${uid}-bodyclip)`} opacity="0.55">
          {scene.corners.map((c, i) => (
            <ellipse
              key={i}
              cx={500 + (c.x - 500) * 0.58 - 30}
              cy={480 + (c.y - 480) * 0.58 - 30}
              rx={95}
              ry={70}
              fill={palette.brandCream}
              opacity="0.28"
              filter={`url(#${uid}-spec-blur)`}
            />
          ))}
        </g>

        {/* Stitched vinyl seams as a groove: shadow edge, lit edge, thread. */}
        <g className="blot-seams" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d={scene.seamPath} stroke={palette.blotAmbient} strokeWidth="7" opacity="0.28" transform="translate(2 3)" />
          <path d={scene.seamPath} stroke={palette.brandCream} strokeWidth="3" opacity="0.35" transform="translate(-2 -2)" />
          <path d={scene.seamPath} stroke={palette.blotSeam} strokeWidth="3.5" opacity="0.9" />
          <path d={scene.seamPath} stroke={palette.brandCream} strokeWidth="1.6" strokeDasharray="9 11" opacity="0.75" />
        </g>

        {/* Heart glow: a wide bloom across the lower face, clipped to the body,
            with the core under it. */}
        <g className="blot-heart" clipPath={`url(#${uid}-bodyclip)`}>
          <ellipse
            cx={scene.heart.cx}
            cy={scene.heart.cy + heartR * 0.2}
            rx={heartR * 3.4}
            ry={heartR * 2.6}
            fill={`url(#${uid}-bloom)`}
            opacity="0.8"
          />
          <circle
            cx={scene.heart.cx}
            cy={scene.heart.cy}
            r={heartR * 1.15}
            fill={palette.blotHeart}
            opacity="0.55"
            filter={`url(#${uid}-heart-blur)`}
          />
        </g>

        {/* Cheeks — blush under the visor's outer ends. */}
        <g className="blot-cheeks">
          <ellipse cx={cheekPair.left.cx} cy={cheekPair.left.cy} rx={cheekPair.left.rx} ry={cheekPair.left.ry} fill={palette.blotHeart} opacity={cheekPair.left.opacity} filter={`url(#${uid}-heart-blur)`} />
          <ellipse cx={cheekPair.right.cx} cy={cheekPair.right.cy} rx={cheekPair.right.rx} ry={cheekPair.right.ry} fill={palette.blotHeart} opacity={cheekPair.right.opacity} filter={`url(#${uid}-heart-blur)`} />
        </g>

        {/* Visor — the eye-band; bows into a smile or a wince, tilts on drag. */}
        <g
          className="blot-visor"
          transform={visorTilt !== 0 ? `rotate(${visorTilt.toFixed(2)} ${scene.visor.cx} ${scene.visor.cy})` : undefined}
        >
          {/* The glass: a soft drop into the vinyl, the dark band, a curved
              shine along its top, one hard eye-shine. */}
          <path d={visorD} fill={palette.blotAmbient} opacity="0.35" transform="translate(0 5)" />
          <path d={visorD} fill={`url(#${uid}-glass)`} />
          <path d={visorD} fill={`url(#${uid}-glass-shine)`} transform={`translate(${visorBox.cx} ${visorBox.cy}) scale(0.92 0.55) translate(${-visorBox.cx} ${-visorBox.cy - visorBox.height * 0.3})`} />
          <ellipse
            cx={visorBox.cx - visorBox.width * 0.3}
            cy={visorBox.cy - visorBox.height * 0.12}
            rx={Math.max(9, visorBox.height * 0.15)}
            ry={Math.max(6, visorBox.height * 0.1)}
            fill={palette.brandCream}
            opacity="0.9"
          />
        </g>

        {/* Brows — two capsules that tilt and lift with the expression. */}
        <g className="blot-brows">
          {[browPair.left, browPair.right].map((b, i) => (
            <rect
              key={i}
              x={b.x - b.length / 2}
              y={b.y - b.thickness / 2}
              width={b.length}
              height={b.thickness}
              rx={b.thickness / 2}
              fill={palette.blotVisor}
              opacity="0.92"
              transform={`rotate(${b.angle.toFixed(2)} ${b.x} ${b.y})`}
            />
          ))}
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
