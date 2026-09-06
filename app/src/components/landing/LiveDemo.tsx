'use client';

/*
 * The landing's live demo (master prompt D): the Blot and its five dials,
 * fully working, no wallet, no clock, no stakes — the toy IS the pitch.
 * Layout follows the two-layer rule exactly as the battle screen will:
 * the Blot on the pink field, every number and control on the plum card.
 *
 * PID §4.3 discipline holds even here: one Even-split action, no presets,
 * no shape names. The demo state is local and thrown away — nothing a
 * visitor does here touches storage or the network.
 */

import { useState } from 'react';
import { EVEN_SPLIT, type Allocation } from '@/battle/allocation';
import { COPY } from '@/copy';
import { BlotMorph } from '@/components/blot/BlotMorph';
import { StatDials } from '@/components/blot/StatDials';
import { rebalance } from '@/components/blot/rebalance';
import { useBlotSprings, usePrefersReducedMotion } from '@/components/blot/springs';

export function LiveDemo() {
  const [target, setTarget] = useState<Allocation>(EVEN_SPLIT);
  const [dragStat, setDragStat] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  const reduced = usePrefersReducedMotion();
  const { display, velocity } = useBlotSprings(target, reduced);

  return (
    <div className="overflow-hidden rounded-3xl bg-brand-cream/40">
      <div className="flex items-center justify-center py-4">
        <BlotMorph
          allocation={target}
          display={display}
          velocity={velocity}
          dragStat={dragStat}
          mood={touched ? 'focused' : 'idle'}
          size={280}
        />
      </div>
      <div className="bg-game-base p-5">
        <StatDials
          target={target}
          display={display}
          dragStat={dragStat}
          onDrag={(k, t) => {
            setTouched(true);
            setTarget((a) => rebalance(a, k, t));
          }}
          onDragStart={setDragStat}
          onDragEnd={() => setDragStat(null)}
          onEvenSplit={() => setTarget(EVEN_SPLIT)}
        />
        <p className="mt-4 max-w-prose text-[13px] leading-5 text-game-ink-muted">
          {COPY.landing.demoHint}
        </p>
      </div>
    </div>
  );
}
