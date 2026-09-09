'use client';

/*
 * The antics (founder 2026-09-09): "more giphy style animations of blotts
 * jumping around the page. They are akin to minions … running all over the
 * site being cheeky and entertaining."
 *
 * Three decorative performers, all pointer-events: none, all aria-hidden,
 * all still under prefers-reduced-motion (a single resting pose, no
 * travel), none on the play route (nothing may compete with the timer):
 *
 *   <Runner />   — every so often a Blott sprints across the bottom of the
 *                  viewport, two-frame gait, sometimes tripping into a
 *                  tumble halfway, sometimes leaping.
 *   <Peeker />   — a Blott leans in from a viewport edge, looks, and slips
 *                  back out.
 *   <Playground/>— a band of Blotts doing their own thing (bounce, dance,
 *                  wave, nap), used under the seven-made montage.
 *
 * Timing is deliberately sparse: a runner roughly every 40 s, a peek every
 * 30 s or so, offset by a per-mount phase so pages never sync up.
 */

import { useEffect, useState } from 'react';
import { usePrefersReducedMotion } from '@/components/blot/springs';
import { BlottSprite, type BlottPose } from './BlottSprite';
import './blott.css';

type Act = 'run' | 'tumble' | 'leap';

/** Deterministic-enough variety per mount; purely decorative. */
function pick<T>(xs: readonly T[], seed: number): T {
  return xs[Math.abs(Math.floor(seed)) % xs.length];
}

export function Runner({ bottom = 0, periodMs = 40_000 }: { bottom?: number; periodMs?: number }) {
  const reduced = usePrefersReducedMotion();
  const [show, setShow] = useState<{ act: Act; dir: 1 | -1; key: number } | null>(null);

  useEffect(() => {
    if (reduced) return;
    let n = 0;
    let timer: ReturnType<typeof setTimeout>;
    const go = () => {
      n += 1;
      const seed = Date.now() / 997 + n * 7;
      setShow({ act: pick(['run', 'run', 'leap', 'tumble'] as const, seed), dir: n % 3 === 0 ? -1 : 1, key: n });
      timer = setTimeout(go, periodMs + (seed % 9) * 1000);
    };
    timer = setTimeout(go, 2500);
    return () => clearTimeout(timer);
  }, [reduced, periodMs]);

  if (reduced || !show) return null;
  return (
    <div
      className={`blott-runner is-${show.act}${show.dir === -1 ? ' is-leftward' : ''}`}
      style={{ bottom }}
      aria-hidden="true"
      key={show.key}
      onAnimationEnd={(e) => {
        if (e.animationName === 'blott-run-across') setShow(null);
      }}
    >
      <span className="blott-gait">
        <BlottSprite pose="run-a" size={72} flip={show.dir === -1} className="gait-a" />
        <BlottSprite pose="run-b" size={72} flip={show.dir === -1} className="gait-b" />
        <BlottSprite pose="jump" size={72} flip={show.dir === -1} className="gait-leap" />
        <BlottSprite pose="tumble" size={72} flip={show.dir === -1} className="gait-tumble" />
      </span>
    </div>
  );
}

export function Peeker({ side = 'right', periodMs = 30_000 }: { side?: 'left' | 'right'; periodMs?: number }) {
  const reduced = usePrefersReducedMotion();
  const [key, setKey] = useState(0);
  const [pose, setPose] = useState<BlottPose>('peek');

  useEffect(() => {
    if (reduced) return;
    let n = 0;
    let timer: ReturnType<typeof setTimeout>;
    const go = () => {
      n += 1;
      setPose(pick(['peek', 'peek', 'wave', 'hero'] as const, Date.now() / 1013 + n));
      setKey(n);
      timer = setTimeout(go, periodMs + (n % 4) * 2500);
    };
    timer = setTimeout(go, 9000);
    return () => clearTimeout(timer);
  }, [reduced, periodMs]);

  if (reduced || key === 0) return null;
  return (
    <div className={`blott-peeker is-${side}`} aria-hidden="true" key={key}>
      <BlottSprite pose={pose} size={96} flip={side === 'right'} />
    </div>
  );
}

const PLAYGROUND_ACTS = ['bounce', 'dash', 'dance', 'wave', 'nap', 'tumble', 'leap'] as const;
type PlaygroundAct = (typeof PLAYGROUND_ACTS)[number];
const POSE_FOR: Record<PlaygroundAct, BlottPose> = {
  bounce: 'cheer',
  dash: 'run-a',
  dance: 'dance',
  wave: 'wave',
  nap: 'sleep',
  tumble: 'tumble',
  leap: 'jump',
};

/**
 * A band of `count` Blotts each doing something. `seeds` (e.g. the seven
 * battles' first stat) spreads the acts so two runs never look identical;
 * purely decorative, nothing here reads the allocation for anything else.
 */
export function Playground({ count, seeds = [], size = 64 }: { count: number; seeds?: readonly number[]; size?: number }) {
  const reduced = usePrefersReducedMotion();
  return (
    <div className={`blott-playground${reduced ? ' is-still' : ''}`} aria-hidden="true" data-testid="blott-playground">
      {Array.from({ length: count }, (_, i) => {
        const act = pick(PLAYGROUND_ACTS, (seeds[i] ?? 0) + i * 3);
        const delay = (i * 0.7) % 3.1;
        return (
          <span
            key={i}
            className={`blott-actor is-${act}`}
            style={{ animationDelay: `${delay.toFixed(2)}s`, left: `${((i + 0.5) / count) * 100}%` }}
          >
            {act === 'dash' ? (
              <span className="blott-gait">
                <BlottSprite pose="run-a" size={size} className="gait-a" />
                <BlottSprite pose="run-b" size={size} className="gait-b" />
              </span>
            ) : (
              <BlottSprite pose={POSE_FOR[act]} size={size} />
            )}
          </span>
        );
      })}
    </div>
  );
}
