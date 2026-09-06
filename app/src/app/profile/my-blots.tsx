'use client';

/*
 * My Blots (master prompt D — Profile): every locked still on this
 * device, newest first, straight out of the IndexedDB store the battle
 * run writes (src/battle/stills.ts). CLIENT-SIDE ONLY — these images
 * never left the device, and this grid never asks the network for them.
 * A still shows shapes, not numbers, so the grid leaks nothing even
 * over someone's shoulder; the share affordance reuses the same
 * files-or-download path as the montage.
 */

import { useEffect, useState } from 'react';
import { COPY } from '@/copy';
import { Card } from '@/components/ui/card';
import { allStills, type StoredStill } from '@/battle/stills';

interface Row extends StoredStill {
  url: string;
}

export function MyBlots() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    allStills().then((stills) => {
      if (cancelled) return;
      const withUrls = stills.map((s) => {
        const url = URL.createObjectURL(s.png);
        urls.push(url);
        return { ...s, url };
      });
      setRows(withUrls);
    });
    return () => {
      cancelled = true;
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, []);

  if (!rows || rows.length === 0) return null; // no stills on this device — no empty shell

  return (
    <Card className="p-5">
      <h2 className="mb-1 text-[12px] uppercase tracking-[0.14em] text-ink-muted">
        {COPY.profile.myBlots}
      </h2>
      <p className="mb-4 text-[12px] leading-4 text-ink-muted">{COPY.profile.myBlotsNote}</p>
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {rows.map((s) => (
          <li key={s.key} className="group relative overflow-hidden rounded-xl bg-brand-cream">
            {/* eslint-disable-next-line @next/next/no-img-element -- object URLs from IndexedDB; next/image cannot serve these */}
            <img src={s.url} alt={`Battle ${s.battle} Blot`} className="aspect-square w-full object-cover" />
            <span className="absolute bottom-1 left-1.5 font-mono text-[10px] font-semibold text-brand-berry">
              {s.pool.slice(0, 4)}… · {s.battle}
            </span>
            <button
              type="button"
              aria-label={`Share battle ${s.battle} Blot`}
              onClick={() => shareStill(s)}
              className="absolute right-1 top-1 hidden rounded-full bg-brand-berry/80 px-2 py-1 font-mono text-[10px] uppercase text-brand-cream group-hover:block group-focus-within:block"
            >
              {COPY.battle.share}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

async function shareStill(s: Row) {
  const file = new File([s.png], `blotto-battle-${s.battle}.png`, { type: 'image/png' });
  const text = COPY.battle.shareTextFirst;
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text });
      return;
    }
  } catch {
    /* fall through to download */
  }
  const a = document.createElement('a');
  a.href = s.url;
  a.download = `blotto-battle-${s.battle}.png`;
  a.click();
}
