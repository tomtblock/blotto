'use client';

/*
 * The landing's live demo (master prompt D): fully working, no wallet, no
 * stakes — the toy IS the pitch. Founder 2026-09-24: the toy is the BOARD
 * when NEXT_PUBLIC_BATTLE_BOARD=1 — the same map, troops, stepper and
 * clock the run uses, so the landing teaches the exact object a player
 * plays on. Unset, the practice machine (the cabinet with its dials) stays
 * exactly as it was (founder 2026-09-09 / 2026-09-16).
 *
 * The demo state is local and thrown away — nothing a visitor does here
 * touches storage or the network. In demo mode the BoardFlow draws no
 * seal and no leave guard; the review offers "Try again".
 */

import { useState } from 'react';
import { EVEN_SPLIT, type Allocation } from '@/battle/allocation';
import { COPY } from '@/copy';
import { BlottRaster } from '@/components/blott/BlottRaster';
import { Cabinet } from '@/components/blot/Cabinet';
import { StatDials } from '@/components/blot/StatDials';
import { NO_LOCKS, rebalanceLocked, type Locks } from '@/components/blot/rebalance';
import { useBlotSprings, usePrefersReducedMotion } from '@/components/blot/springs';
import { BoardFlow } from '@/battle/components/board/BoardFlow';

const BATTLE_BOARD = process.env.NEXT_PUBLIC_BATTLE_BOARD === '1';

export function LiveDemo() {
  return BATTLE_BOARD ? <BoardDemo /> : <DialDemo />;
}

function BoardDemo() {
  return (
    <div className="flex flex-col gap-3" data-testid="board-demo">
      <BoardFlow mode="easy" demo onConfirm={() => {}} />
      <p className="max-w-prose text-[13px] leading-5 text-ink-muted">{COPY.landing.demoBoardHint}</p>
    </div>
  );
}

function DialDemo() {
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
