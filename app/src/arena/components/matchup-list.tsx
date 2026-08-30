'use client';

/*
 * The revealed field: a deterministic three-matchup highlight reel (the
 * story in ~two minutes) above the full 63-row list — every opponent
 * playable one at a time. Chips come from the scripts (engine-derived);
 * thumbnails are the opponents' now-public first characters — after the
 * reveal, a build IS readable, that's the product's honesty working.
 */

import { COPY } from '@/copy';
import type { PlayerResult } from '@/arena/engine';
import type { BattleSet } from '@/arena/engine';
import { Creature } from '@/arena/creature/creature';
import type { RevealClass } from '@/reveal/types';
import { matchupOutcome, type BattleScript } from '@/arena/playback/script';

export interface MatchupListProps {
  scripts: readonly BattleScript[];
  featured: readonly number[];
  sets: readonly (BattleSet | null)[];
  results: readonly PlayerResult[];
  classBySeat: ReadonlyMap<number, RevealClass>;
  onSelect: (oppSeat: number) => void;
}

const CHIP: Record<string, { label: string; className: string }> = {
  win: { label: 'W', className: 'bg-price-up text-[var(--color-base)]' },
  loss: { label: 'L', className: 'bg-price-down text-[var(--color-base)]' },
  draw: { label: 'D', className: 'bg-[var(--color-overlay)]' },
};

function MatchupRow({
  script,
  set,
  result,
  classIndex,
  onSelect,
}: {
  script: BattleScript;
  set: BattleSet;
  result: PlayerResult;
  classIndex: RevealClass | null;
  onSelect: (oppSeat: number) => void;
}) {
  const chip = CHIP[matchupOutcome(script)];
  return (
    <li>
      <button
        type="button"
        className="flex w-full items-center gap-3 rounded border px-3 py-2 text-left hover:bg-[var(--color-raised)]"
        onClick={() => onSelect(script.oppSeat)}
      >
        <Creature
          allocation={set[0]}
          uid={`row-${script.oppSeat}`}
          classIndex={classIndex}
          className="h-10 w-10 shrink-0"
        />
        <span className="text-sm">{COPY.arena.battle.matchupTitle(script.oppSeat)}</span>
        <span className="text-xs opacity-60">{COPY.results.rank(result.rank)}</span>
        <span
          className={`ml-auto flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${chip.className}`}
        >
          {chip.label}
        </span>
        <span className="font-mono text-xs tabular-nums opacity-70">
          {script.tally.wins}–{script.tally.draws}–{script.tally.losses}
        </span>
      </button>
    </li>
  );
}

export function MatchupList({
  scripts,
  featured,
  sets,
  results,
  classBySeat,
  onSelect,
}: MatchupListProps) {
  const byOpp = new Map(scripts.map((s) => [s.oppSeat, s]));
  const row = (seat: number) => {
    const script = byOpp.get(seat);
    const set = sets[seat];
    if (!script || !set) return null;
    return (
      <MatchupRow
        key={seat}
        script={script}
        set={set}
        result={results[seat]}
        classIndex={classBySeat.get(seat) ?? null}
        onSelect={onSelect}
      />
    );
  };
  return (
    <div className="flex flex-col gap-5">
      {featured.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm opacity-70">{COPY.arena.results.highlights}</h3>
          <ol className="flex flex-col gap-2">{featured.map(row)}</ol>
        </section>
      )}
      <section>
        <h3 className="mb-2 text-sm opacity-70">{COPY.arena.results.allMatchups}</h3>
        <ol className="flex flex-col gap-2">
          {scripts.map((s) => (featured.includes(s.oppSeat) ? null : row(s.oppSeat)))}
        </ol>
      </section>
    </div>
  );
}
