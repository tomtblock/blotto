'use client';

/*
 * Per-stat critically-damped springs (brief §3): the dials write the
 * TARGET instantly; the visual renders the DISPLAY, which follows the
 * target through one spring per stat — stiffness 180, damping 22, mass 1
 * (ζ ≈ 0.82, overshoot ≈ 1%, inside the ≤ 8% spec).
 *
 * WHY SPRINGS ON THE INPUTS, NOT PATH MORPHING: interpolating the
 * allocation guarantees every intermediate frame is a valid Blot — the
 * geometry is continuous in the allocation, so no tweened frame can be a
 * seam, a pop or an illegal shape. SVG path strings are never tweened.
 *
 * Under `prefers-reduced-motion` (or `snap`, used by lock-in) the display
 * IS the target: no rAF ticks at all, state changes render in one frame
 * (brief §9.8).
 *
 * Shape of the hook, for review: the integrator lives in refs mutated
 * only inside the rAF callback and effects (never during render); each
 * tick publishes an immutable frame through setState, and the render path
 * reads only props and that frame — the React 19 hooks rules hold.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

export const SPRING_STIFFNESS = 180;
export const SPRING_DAMPING = 22;

export interface SpringState {
  /** The animated allocation the renderer draws — fractional mid-flight. */
  display: readonly number[];
  /** Per-stat velocities (points/second) — drives the visor's drag tilt. */
  velocity: readonly number[];
}

const ZEROS: readonly number[] = [0, 0, 0, 0, 0];

/**
 * Follow `target` through per-stat springs. `snap` (reduced motion,
 * lock-in) returns the target itself with zero velocity and ticks no rAF.
 */
export function useBlotSprings(target: readonly number[], snap = false): SpringState {
  const pos = useRef<number[] | null>(null);
  const vel = useRef<number[]>([...ZEROS]);
  const raf = useRef<number | null>(null);
  const goal = useRef<readonly number[]>(target);
  // Published frames; null = settled or never animated → render the target.
  const [frame, setFrame] = useState<SpringState | null>(null);

  const key = target.join(',');
  useEffect(() => {
    goal.current = target;
    if (snap) {
      if (raf.current !== null) {
        cancelAnimationFrame(raf.current);
        raf.current = null;
      }
      pos.current = [...target];
      vel.current = [...ZEROS];
      // Invalidate any stale frame asynchronously (lint: no sync setState).
      const id = requestAnimationFrame(() => setFrame(null));
      return () => cancelAnimationFrame(id);
    }
    pos.current ??= [...target]; // first mount: no entry animation
    if (raf.current !== null) return; // loop already running; it reads goal
    let last = performance.now();
    const tick = (now: number) => {
      const p = pos.current;
      if (!p) return;
      // Clamp dt so a background-tab pause cannot explode the integrator.
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      let settled = true;
      for (let i = 0; i < p.length; i++) {
        const x = p[i];
        const v = vel.current[i];
        const t = goal.current[i];
        const a = SPRING_STIFFNESS * (t - x) - SPRING_DAMPING * v;
        const nv = v + a * dt;
        const nx = x + nv * dt;
        vel.current[i] = nv;
        p[i] = nx;
        if (Math.abs(nv) > 0.01 || Math.abs(nx - t) > 0.01) settled = false;
      }
      if (settled) {
        pos.current = [...goal.current];
        vel.current = [...ZEROS];
        raf.current = null;
        setFrame(null); // display returns to the exact target
      } else {
        raf.current = requestAnimationFrame(tick);
        setFrame({ display: [...p], velocity: [...vel.current] });
      }
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current !== null) {
        cancelAnimationFrame(raf.current);
        raf.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is target's value identity; re-running per array identity would restart the loop every drag
  }, [snap, key]);

  if (snap || frame === null) return { display: target, velocity: ZEROS };
  return frame;
}

/* Media-query subscription for prefers-reduced-motion, SSR-safe (false on
 * the server — the client corrects on hydration before any animation). */
const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReduced(onChange: () => void): () => void {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false
  );
}
