'use client';

/*
 * My Blots (master prompt D — Profile): every locked still on this
 * device, newest first, straight out of the IndexedDB store the battle
 * run writes (src/battle/stills.ts). CLIENT-SIDE ONLY — these images
 * never left the device, and this grid never asks the network for them.
 *
 * NO SHARE HERE (2026-09-13). This grid used to carry a per-still Share
 * button, on the reasoning that "a still shows shapes, not numbers, so it
 * leaks nothing". That reasoning was wrong: a still is the allocation
 * drawn — the Blott's silhouette is a deterministic, per-stat-monotone
 * function of its five stats (components/blott/warp.ts) — and this grid
 * holds stills from pools that may still be OPEN. Sharing one published a
 * sealed battle while opponents could still enter against it. The player's
 * own screen is the player's business; publication is not offered until
 * the pool has closed (pools/[pool]/results/share-seven.tsx).
 */

import { useEffect, useState } from 'react';
import { COPY } from '@/copy';
import { Card } from '@/components/ui/card';
import { allStills, type StoredStill } from '@/battle/stills';
import { sweepStills } from '@/battle/stills-sweep';
import { indexerApi } from '@/data/api';

interface Row extends StoredStill {
  url: string;
}

export function MyBlots() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    // Forget the stills of pools whose allocation will never be published
    // (2026-09-16, data minimisation), then show what remains.
    sweepStills(indexerApi())
      .then(() => allStills())
      .then((stills) => {
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
          <li key={s.key} className="relative overflow-hidden rounded-xl bg-brand-cream">
            {/* eslint-disable-next-line @next/next/no-img-element -- object URLs from IndexedDB; next/image cannot serve these */}
            <img src={s.url} alt={`Battle ${s.battle} Blot`} className="aspect-square w-full object-cover" />
            <span className="absolute bottom-1 left-1.5 font-mono text-[10px] font-semibold text-brand-berry">
              {s.pool.slice(0, 4)}… · {s.battle}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

