'use client';

/*
 * <BlottRaster /> — the Blott in the machine's window, painted from the
 * rendered character and warped live by the allocation (warp.ts). Drop-in
 * for <BlotMorph /> on the surfaces that carry the product's face: the
 * landing demo, the run's ready screen and the seven battle screens.
 *
 * What moves and why (all continuous, all a function of the inputs):
 *   - the five corners follow the animated allocation (the caller's springs,
 *     or the component's own) — the readout;
 *   - the body leans toward the dial under the hand (velocity);
 *   - the belly glow follows Heart, and brightens while a dial is held;
 *   - idle surfaces breathe (±3% puff on a 4 s sine); focused ones do not;
 *   - the lock-in beat crossfades to the cheer frame while the Blott drops.
 *
 * WebGL unavailable or reduced motion with no GL: a plain <img> of the
 * hero frame, scaled by the average width/height factors, so the page
 * never shows a blank window. Textures are decoded once per URL and
 * uploaded once per context; one context per instance — small badges keep
 * the drawn BlotMorph, so a pool list never opens a dozen contexts.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { STAT_NAMES, type Allocation } from '@/battle/allocation';
import { COPY } from '@/copy';
import { useBlotSprings, usePrefersReducedMotion } from '@/components/blot/springs';
import {
  CHEER_URL,
  HERO_URL,
  createWarp,
  drawWarp,
  loadImage,
  radialFactors,
  uploadTexture,
  type WarpProgram,
} from './warp';
import './blott.css';

export type BlottMood = 'idle' | 'focused' | 'locked' | 'paid';

export interface BlottRasterProps {
  allocation: Allocation;
  /** Rendered square size in CSS px. */
  size: number;
  mood?: BlottMood;
  /** Animated values from the caller's springs (shared with the dials). */
  display?: readonly number[];
  /** Per-stat velocities — drives the lean. */
  velocity?: readonly number[];
  /** Pointer currently down on a dial: glow +, lean toward it. */
  dragStat?: number | null;
  reduceMotion?: boolean;
  className?: string;
}

/** The accessible one-liner. */
export function blottAriaLabel(allocation: Allocation): string {
  return COPY.battle.blottAria(allocation.map((v, i) => `${STAT_NAMES[i]} ${v}`).join(', '));
}

/** Lean toward the dragged corner from its velocity: ±0.12 shear at most. */
function leanFor(dragStat: number | null | undefined, velocity: readonly number[]): number {
  if (dragStat === null || dragStat === undefined || dragStat < 0 || dragStat > 4) return 0;
  const lean = Math.cos(((-90 + dragStat * 72) * Math.PI) / 180);
  const v = velocity[dragStat] ?? 0;
  const k = Math.max(-1, Math.min(1, v / 120));
  return -lean * k * 0.12;
}

const MAX_DPR = 2;

export function BlottRaster({
  allocation,
  size,
  mood = 'idle',
  display,
  velocity,
  dragStat = null,
  reduceMotion,
  className,
}: BlottRasterProps) {
  const prefersReduced = usePrefersReducedMotion();
  const reduced = reduceMotion ?? prefersReduced;
  const springs = useBlotSprings(allocation, reduced || display !== undefined);
  const shown = display ?? springs.display;
  const vels = velocity ?? springs.velocity;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const warpRef = useRef<WarpProgram | null>(null);
  const texRef = useRef<{ hero: WebGLTexture; cheer: WebGLTexture } | null>(null);
  const [glState, setGlState] = useState<'pending' | 'ready' | 'unavailable'>('pending');
  // The crossfade to the cheer frame persists across re-armed draw loops.
  const mixRef = useRef(0);

  // Context + textures, once per mount.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let alive = true;
    let warp: WarpProgram | null = null;
    try {
      warp = createWarp(canvas);
    } catch {
      warp = null;
    }
    if (!warp) {
      // Deferred so the fallback swap never lands as a synchronous setState.
      const t = setTimeout(() => setGlState('unavailable'), 0);
      return () => clearTimeout(t);
    }
    warpRef.current = warp;
    Promise.all([loadImage(HERO_URL), loadImage(CHEER_URL)])
      .then(([hero, cheer]) => {
        if (!alive || !warpRef.current) return;
        texRef.current = {
          hero: uploadTexture(warpRef.current.gl, hero),
          cheer: uploadTexture(warpRef.current.gl, cheer),
        };
        setGlState('ready');
      })
      .catch(() => {
        if (alive) setGlState('unavailable');
      });
    return () => {
      alive = false;
      const gl = warpRef.current?.gl;
      warpRef.current = null;
      texRef.current = null;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  // The draw loop: one frame per change; a running loop only while idle
  // breathing or crossfading to the cheer frame.
  useEffect(() => {
    if (glState !== 'ready') return;
    const canvas = canvasRef.current;
    const warp = warpRef.current;
    const tex = texRef.current;
    if (!canvas || !warp || !tex) return;
    const dpr = Math.min(MAX_DPR, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const px = Math.round(size * dpr);
    if (canvas.width !== px || canvas.height !== px) {
      canvas.width = px;
      canvas.height = px;
    }
    let raf = 0;
    const start = performance.now();
    const target = mood === 'locked' ? 1 : 0;
    const lean = reduced ? 0 : leanFor(dragStat, vels);
    const glowBoost = dragStat !== null && dragStat !== undefined ? 0.25 : 0;
    const frame = (now: number) => {
      const t = (now - start) / 1000;
      const breathe = mood === 'idle' && !reduced ? 1 + 0.03 * Math.sin((t / 4) * 2 * Math.PI) : 1;
      mixRef.current = reduced ? target : mixRef.current + (target - mixRef.current) * 0.18;
      drawWarp(warp, tex.hero, tex.cheer, {
        display: shown,
        puff: breathe,
        lean,
        glowBoost,
        mix: mixRef.current,
      });
      const animating = (mood === 'idle' && !reduced) || Math.abs(target - mixRef.current) > 0.01;
      if (animating) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // Re-armed whenever a drawn input changes — every value the loop reads is
    // a dependency, so the closure is always the current frame's truth.
  }, [glState, size, shown, vels, dragStat, mood, reduced]);

  const label = blottAriaLabel(allocation);
  const fallback = useMemo(() => {
    const f = radialFactors(shown);
    const sx = (f[1] + f[4] + f[2] + f[3]) / 4;
    const sy = (f[0] + (f[2] + f[3]) / 2) / 2;
    return { sx: Math.min(1.35, sx), sy: Math.min(1.35, sy) };
  }, [shown]);

  return (
    <div
      role="img"
      aria-label={label}
      className={`blott-frame${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
      data-testid="blott"
      data-gl={glState}
    >
      <canvas
        ref={canvasRef}
        className="blott-canvas"
        style={{ width: size, height: size, opacity: glState === 'ready' ? 1 : 0 }}
        aria-hidden="true"
      />
      {glState !== 'ready' ? (
        // eslint-disable-next-line @next/next/no-img-element -- the hero frame itself
        <img
          src={HERO_URL}
          alt=""
          width={size}
          height={size}
          draggable={false}
          className="blott-fallback"
          style={{ transform: `scale(${fallback.sx.toFixed(3)}, ${fallback.sy.toFixed(3)})` }}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}
