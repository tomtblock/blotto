'use client';

/*
 * Dial temperature (founder 2026-09-09): "when a dial is increased it should
 * be heating up, and skills which are decreasing are showing blue for cold".
 *
 * One number per stat in [-1, 1]: positive is heat, negative is cold. A
 * change of the TARGET allocation bumps each stat by its delta (about a
 * fifth of a full swing per 20 points), and every temperature decays back
 * toward zero at a fixed rate — so a dial glows while it moves and cools to
 * the plain dial about a second after it stops. The four rows giving way
 * cool as the dragged row heats, which is the whole point: the player sees
 * the budget flowing out of them.
 *
 * Pure feedback: nothing reads this back; reduced motion returns all zeros.
 */

import { useEffect, useRef, useState } from 'react';
import type { Allocation } from '@/battle/allocation';

const ZERO: readonly number[] = [0, 0, 0, 0, 0];
/** Temperature gained per point of change. */
const PER_POINT = 1 / 18;
/** Temperature lost per second. */
const DECAY_PER_S = 1.6;

/** Pure step: apply a delta and one decay interval. Exported for tests. */
export function stepThermals(
  prev: readonly number[],
  from: Allocation,
  to: Allocation,
  dtSeconds: number,
): number[] {
  return prev.map((t, k) => {
    const bumped = Math.max(-1, Math.min(1, t + (to[k] - from[k]) * PER_POINT));
    const decayed = bumped - Math.sign(bumped) * Math.min(Math.abs(bumped), DECAY_PER_S * dtSeconds);
    return Math.abs(decayed) < 0.005 ? 0 : decayed;
  });
}

export function useDialThermals(target: Allocation, reduced: boolean): readonly number[] {
  const [temps, setTemps] = useState<readonly number[]>(ZERO);
  const prevTarget = useRef<Allocation>(target);
  const live = useRef<number[]>([...ZERO]);
  const raf = useRef(0);
  const lastAt = useRef(0);

  useEffect(() => {
    if (reduced) return;
    const from = prevTarget.current;
    prevTarget.current = target;
    if (from === target) return;
    live.current = stepThermals(live.current, from, target, 0);
    setTemps([...live.current]);
    if (raf.current) return;
    lastAt.current = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - lastAt.current) / 1000);
      lastAt.current = now;
      live.current = stepThermals(live.current, target, target, dt);
      setTemps([...live.current]);
      if (live.current.some((t) => t !== 0)) {
        raf.current = requestAnimationFrame(tick);
      } else {
        raf.current = 0;
      }
    };
    raf.current = requestAnimationFrame(tick);
  }, [target, reduced]);

  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    },
    [],
  );

  return reduced ? ZERO : temps;
}
