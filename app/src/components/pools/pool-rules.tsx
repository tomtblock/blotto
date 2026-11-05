'use client';

/*
 * "How this pool…" (V2, founder 2026-09-27): one box with a Plays / Pays
 * toggle, the same control the home card uses. The Plays side is the rule
 * of THIS pool's mode (Phase B), config-driven (D-B6): the minutes come
 * from the board's clock constant, never typed here.
 *
 * Founder 2026-09-30: the box moved from the pool page onto the entry
 * board's rail (app/play/entry-rail.tsx), so a player reads the rule beside
 * the board they are placing on and the pool page is no longer a stop on
 * the way in. The links under it are the rules and the terms — the two
 * documents the statements below the box refer to.
 *
 * D-E19 (the Ladder): the Pays side states THIS pool's prizes in the
 * founder's prize sentence, its own size and its own minimum field — read
 * from the pool record (`poolLadder`), so a pool of 8 and a pool of 64
 * never borrow each other's rule.
 */

import { useState } from 'react';
import Link from 'next/link';
import { COPY } from '@/copy';
import type { BoardMode } from '@/battle/board/mode';
import type { PoolLadder } from '@/data/format';
import { NeonSection } from '@/components/ui/neon-section';
import { prizeSentence } from './prize-table';
import { Toggle } from '@/components/ui/toggle';

export function PoolRules({
  mode,
  minutes,
  ladder,
  fillHours,
  className = '',
}: {
  mode: BoardMode;
  minutes: number;
  /** THIS pool's size, floor and table (D-E19) — never the launch tables. */
  ladder: PoolLadder;
  fillHours: number;
  className?: string;
}) {
  const [side, setSide] = useState<'plays' | 'pays'>('plays');
  const lines =
    side === 'plays'
      ? COPY.pool.howItPlays(mode, minutes)
      : COPY.pool.aboutPoints({
          prizeSentence: prizeSentence(ladder.prizeAmounts),
          capacity: ladder.capacity,
          minSeats: ladder.minSeats,
          fillHours,
        });
  return (
    <NeonSection heading={COPY.pool.howThisPool} className={className} data-testid="pool-rules">
      <div className="mb-4">
        <Toggle
          label={COPY.pool.rulesToggleAria}
          value={side}
          onChange={setSide}
          options={[
            { value: 'plays', label: COPY.pool.rulesPlays },
            { value: 'pays', label: COPY.pool.rulesPays },
          ]}
          tone="cream"
          data-testid="pool-rules-toggle"
        />
      </div>
      <ul className="flex list-disc flex-col gap-2.5 pl-5 text-[14px] leading-[21px] text-ink marker:text-brand" data-testid={`pool-rules-${side}`}>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="mt-4 flex gap-5 text-[14px] text-ink-muted">
        <Link href="/rules" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
          {COPY.rules.title}
        </Link>
        <Link href="/terms" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
          {COPY.terms.title}
        </Link>
      </p>
    </NeonSection>
  );
}
