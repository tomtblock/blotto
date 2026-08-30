'use client';

/*
 * The post-reveal summary: the viewer's canonical rank, score and prize —
 * all from the RESCORED results (engine output; loadField refused anything
 * that didn't reproduce) — with the honest pointers out to the plain
 * results table and the Verify page. Score is half-points; divided by two
 * HERE, at display time only (the engine's rule).
 */

import Link from 'next/link';
import { COPY } from '@/copy';
import { lamportsToSol } from '@/data/format';
import type { PlayerResult } from '@/arena/engine';

const scoreDisplay = (scoreHalf: number) =>
  `${Math.floor(scoreHalf / 2)}${scoreHalf % 2 === 1 ? '½' : ''}`;

export function ResultsOutro({
  pool,
  viewerSeat,
  spectator,
  results,
}: {
  pool: string;
  viewerSeat: number;
  spectator: boolean;
  results: readonly PlayerResult[];
}) {
  const mine = results[viewerSeat];
  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="font-[family-name:var(--font-unbounded)] text-lg">
        {COPY.arena.results.title}
      </h2>
      {spectator && <p className="text-sm opacity-70">{COPY.arena.results.spectator}</p>}
      <div className="flex items-baseline gap-4">
        <span className="text-2xl">{COPY.results.rank(mine.rank)}</span>
        <span className="font-mono tabular-nums opacity-80">
          {scoreDisplay(mine.scoreHalf)} battles won
        </span>
        {mine.amountLamports > 0n && (
          <span className="ml-auto font-mono text-xl tabular-nums">
            {lamportsToSol(mine.amountLamports.toString())} SOL
          </span>
        )}
      </div>
      <p className="max-w-prose text-xs opacity-60">{COPY.arena.results.recomputeNote}</p>
      <div className="flex gap-4 text-sm">
        <Link className="underline opacity-80" href={`/pools/${pool}/results`}>
          {COPY.arena.results.resultsLink}
        </Link>
        <Link className="underline opacity-80" href={`/verify?pool=${pool}`}>
          {COPY.arena.results.verifyLink}
        </Link>
      </div>
    </section>
  );
}
