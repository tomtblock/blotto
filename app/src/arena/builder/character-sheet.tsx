'use client';

/*
 * One character screen: the live-morphing creature above the SHARED pentagon
 * radar. Every drag reshapes the creature — "the stats ARE the character"
 * made literal. All mechanic controls are the machine's own events; the R9
 * timer keeps battle-flow.tsx's exact treatment (visible countdown,
 * data-warning at ≤5s).
 *
 * Explicitly ABSENT, by rule (PID §4.3): archetype presets, quick-set chips,
 * snapping. There is one button beyond lock-in: even split.
 */

import type { Dispatch } from 'react';
import { COPY } from '@/copy';
import type { BattleFlowEvent, BattleScreenState } from '@/battle/machine';
import { PentagonRadar } from '@/battle/components/pentagon-radar';
import { characterFor } from '@/arena/characters';
import { Creature } from '@/arena/creature/creature';

export function CharacterSheet({
  state,
  dispatch,
}: {
  state: BattleScreenState;
  dispatch: Dispatch<BattleFlowEvent>;
}) {
  const identity = characterFor(state.screen);
  const secondsLeft = Math.ceil(state.remainingMs / 1000);
  return (
    <section className="flex flex-col gap-5">
      <header className="flex items-baseline justify-between">
        <div>
          <h2 className="font-[family-name:var(--font-unbounded)] text-lg">{identity.name}</h2>
          <p className="text-sm opacity-60">{COPY.arena.builder.characterOf(state.screen + 1)}</p>
        </div>
        {/* R9: the timer is VISIBLE. */}
        <output
          className="font-mono text-2xl tabular-nums"
          aria-label="seconds remaining"
          data-warning={secondsLeft <= 5 || undefined}
        >
          {secondsLeft}
        </output>
      </header>
      <div className="h-1 w-full overflow-hidden rounded bg-[var(--color-overlay)]" aria-hidden>
        <div
          className="h-full bg-[var(--color-brand)] transition-[width]"
          style={{ width: `${(state.remainingMs / state.timerBudgetMs) * 100}%` }}
        />
      </div>
      {/* The creature, live from the machine's real displayed allocation. */}
      <div className="flex justify-center" key={state.screen}>
        <Creature
          allocation={state.display}
          uid={`builder-${state.screen}`}
          label={identity.name}
          className="motion-pulse h-40 w-40"
        />
      </div>
      <PentagonRadar
        display={state.display}
        onDrag={(stat, value) => dispatch({ type: 'drag', stat, value })}
      />
      <p className="text-sm opacity-70">{COPY.arena.builder.timerNote}</p>
      <div className="flex gap-3">
        <button
          type="button"
          className="rounded border px-4 py-2"
          onClick={() => dispatch({ type: 'even_split' })}
        >
          {COPY.battle.evenSplit}
        </button>
        <button
          type="button"
          className="ml-auto rounded bg-[var(--color-brand)] px-6 py-2 text-white"
          onClick={() => dispatch({ type: 'lock_in' })}
        >
          {COPY.battle.lockIn}
        </button>
      </div>
    </section>
  );
}
