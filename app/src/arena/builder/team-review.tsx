'use client';

/*
 * The review screen as a team roster: seven creature cards, then the §8.6
 * "decisions are final" statement ABOVE the confirm — a legal-position
 * requirement carried verbatim from the plain flow, not layout taste.
 * Review confirms or abandons; there is no going back to re-play a screen
 * (the machine offers no such event, deliberately).
 */

import { COPY } from '@/copy';
import type { Allocation } from '@/battle/allocation';
import { STAT_NAMES } from '@/battle/allocation';
import { characterFor } from '@/arena/characters';
import { Creature } from '@/arena/creature/creature';

export function TeamReview({
  battles,
  onConfirm,
}: {
  battles: readonly Allocation[];
  onConfirm: () => void;
}) {
  return (
    <section className="flex flex-col gap-6">
      <h2 className="font-[family-name:var(--font-unbounded)] text-lg">
        {COPY.arena.builder.reviewTitle}
      </h2>
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {battles.map((b, k) => {
          const identity = characterFor(k);
          return (
            <li key={k} className="flex flex-col items-center gap-2 rounded border p-3">
              <Creature allocation={b} uid={`review-${k}`} label={identity.name} className="h-24 w-24" />
              <span className="text-sm">{identity.name}</span>
              <span
                className="font-mono text-xs tabular-nums opacity-70"
                aria-label={b.map((v, z) => `${STAT_NAMES[z]} ${v}`).join(', ')}
              >
                {b.join(' · ')}
              </span>
            </li>
          );
        })}
      </ol>
      {/* PID §8.6 — above the confirm, always. */}
      <p className="text-sm font-medium">{COPY.pool.decisionsFinal}</p>
      <button
        type="button"
        className="rounded bg-[var(--color-brand)] px-6 py-3 text-white"
        onClick={onConfirm}
      >
        {COPY.battle.confirm}
      </button>
    </section>
  );
}
