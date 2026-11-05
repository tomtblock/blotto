'use client';

/*
 * The pools tab's size filter (D-E19, the Ladder): "All · 8 · 16 · 32 · 64"
 * over the size groups the server rendered. The groups arrive as finished
 * server markup; this only chooses which of them to show, so the list is in
 * the server HTML whatever is chosen and nothing here reads the indexer.
 * A size with no pool on the tab is listed greyed (the one control shape,
 * components/ui/toggle.tsx).
 */
import { useState, type ReactNode } from 'react';
import { COPY } from '@/copy';
import { Toggle } from '@/components/ui/toggle';

export interface SizeGroup {
  key: string;
  capacity: number;
  node: ReactNode;
}

export function SizeFilter({ sizes, groups }: { sizes: readonly number[]; groups: readonly SizeGroup[] }) {
  const [size, setSize] = useState<string>('all');
  const present = new Set(groups.map((g) => g.capacity));
  const shown = size === 'all' ? groups : groups.filter((g) => String(g.capacity) === size);
  return (
    <div className="flex flex-col gap-10">
      <Toggle
        label={COPY.pool.sizeFilterAria}
        value={size}
        onChange={setSize}
        options={[
          { value: 'all', label: COPY.pool.sizeFilterAll },
          ...sizes.map((c) => ({
            value: String(c),
            label: String(c),
            ariaLabel: COPY.prizes.players(c),
            disabled: !present.has(c),
            disabledReason: COPY.landing.sizeNotOpen,
          })),
        ]}
        tone="berry"
        className="self-start"
        data-testid="pools-size-filter"
      />
      {shown.map((g) => (
        <div key={g.key} data-size={g.capacity}>
          {g.node}
        </div>
      ))}
    </div>
  );
}
