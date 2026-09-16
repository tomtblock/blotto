'use client';

/*
 * The landing's live demo (master prompt D): the Blot and its five dials,
 * fully working, no wallet, no clock, no stakes — the toy IS the pitch.
 * Founder 2026-09-09: the toy is the MACHINE — the same cabinet the player
 * plays in (Cabinet.tsx), the Blot in the window, the dials on the deck —
 * so the landing page teaches the exact object the run uses.
 *
 * PID §4.3 discipline holds even here: one Even-split action, no presets,
 * no shape names. The demo state is local and thrown away — nothing a
 * visitor does here touches storage or the network.
 */

import { useState } from 'react';
import { EVEN_SPLIT, type Allocation } from '@/battle/allocation';
import { COPY } from '@/copy';
import { BlottRaster } from '@/components/blott/BlottRaster';
import { Cabinet } from '@/components/blot/Cabinet';
import { StatDials } from '@/components/blot/StatDials';
import { NO_LOCKS, rebalanceLocked, type Locks } from '@/components/blot/rebalance';
import { useBlotSprings, usePrefersReducedMotion } from '@/components/blot/springs';

export function LiveDemo() {
  const [target, setTarget] = useState<Allocation>(EVEN_SPLIT);
  const [dragStat, setDragStat] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  // Founder 2026-09-16: the padlocks the machine already has (StatDials,
  // rebalanceLocked — founder 2026-09-13) now work on the practice machine
  // too, so the landing teaches the exact control the run uses. Rule 4 of
  // CHANGE-2026-09-13 §4 holds: Even split clears the locks with the shape.
  // There is no clock here, so a lock starts nothing.
  const [locks, setLocks] = useState<Locks>(NO_LOCKS);
  const reduced = usePrefersReducedMotion();
  const { display, velocity } = useBlotSprings(target, reduced);

  return (
    <Cabinet
      status={COPY.landing.demoStatus}
      stageHeight={300}
      deck={
        <>
          <StatDials
            target={target}
            display={display}
            dragStat={dragStat}
            locks={locks}
            onToggleLock={(k) => {
              setTouched(true);
              setLocks((l) => l.map((v, i) => (i === k ? !v : v)));
            }}
            onDrag={(k, t) => {
              setTouched(true);
              setTarget((a) => rebalanceLocked(a, k, t, locks));
            }}
            onDragStart={setDragStat}
            onDragEnd={() => setDragStat(null)}
            onEvenSplit={() => {
              setTarget(EVEN_SPLIT);
              setLocks(NO_LOCKS);
            }}
          />
          <p className="mt-4 max-w-prose text-[13px] leading-5 text-game-ink-muted">
            {COPY.landing.demoHint}
          </p>
        </>
      }
    >
      <BlottRaster
        allocation={target}
        display={display}
        velocity={velocity}
        dragStat={dragStat}
        mood={touched ? 'focused' : 'idle'}
        size={260}
      />
    </Cabinet>
  );
}
