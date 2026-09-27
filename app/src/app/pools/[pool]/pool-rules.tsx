'use client';

/*
 * "How this pool…" (V2, founder 2026-09-27): the pool page's two rule boxes
 * — "How this pool pays" and "How this pool plays" — as ONE box with a
 * Plays / Pays toggle, the same control the home card uses. The Plays side
 * is the rule of THIS pool's mode (Phase B), config-driven (D-B6): the
 * minutes come from the board's clock constant, never typed here.
 */

import { useState } from 'react';
import Link from 'next/link';
import { COPY } from '@/copy';
import type { BoardMode } from '@/battle/board/mode';
import { NeonSection } from '@/components/ui/neon-section';
import { Toggle } from '@/components/ui/toggle';

export function PoolRules({
  mode,
  minutes,
  minSeats,
  fillHours,
}: {
  mode: BoardMode;
  minutes: number;
  minSeats: number;
  fillHours: number;
}) {
  const [side, setSide] = useState<'plays' | 'pays'>('plays');
  const lines = side === 'plays' ? COPY.pool.howItPlays(mode, minutes) : COPY.pool.aboutPoints(minSeats, fillHours);
  return (
    <NeonSection heading={COPY.pool.howThisPool} className="mb-8" data-testid="pool-rules">
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
      <ul className="flex list-disc flex-col gap-3 pl-5 text-[17px] leading-[26px] text-ink marker:text-brand" data-testid={`pool-rules-${side}`}>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="mt-5 flex gap-5 text-[15px] text-ink-muted">
        <Link href="/rules" className="underline underline-offset-2 hover:text-ink">
          {COPY.rules.title}
        </Link>
        <Link href="/fair-play" className="underline underline-offset-2 hover:text-ink">
          {COPY.fairPlay.title}
        </Link>
      </p>
    </NeonSection>
  );
}
