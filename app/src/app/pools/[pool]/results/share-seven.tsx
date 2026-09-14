'use client';

/*
 * Share my seven (2026-09-13): the seven-Blott montage, offered ONLY here —
 * on the results page of a pool that has closed to entries.
 *
 * It used to be offered on the review screen, before anything was sealed.
 * A Blott's silhouette is a deterministic function of its five stats
 * (components/blott/warp.ts), so that montage was the sealed line-up in
 * silhouette, published while opponents could still enter. Once a pool has
 * sealed nothing can be countered, and the seven are the player's to show.
 *
 * The stills live on the device that made them (battle/stills.ts) — this
 * component reads them from IndexedDB and appears only where all seven are.
 * Nothing is fetched; nothing is uploaded; the share is the player's own
 * action through the platform share sheet or a download.
 */

import { useCallback, useEffect, useState } from 'react';
import { COPY } from '@/copy';
import { allStills } from '@/battle/stills';
import { composeMontage } from '@/battle/montage';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { XMark } from '@/wallet/wallet-icons';

const BATTLES = 7;

export function ShareSeven({ poolAddress, state }: { poolAddress: string; state: string }) {
  const [png, setPng] = useState<{ url: string; blob: Blob } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const r = COPY.results;

  useEffect(() => {
    // Never while entries are open — the whole reason this lives here.
    if (state === 'Open') return;
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      try {
        const mine = (await allStills()).filter((s) => s.pool === poolAddress);
        // One per battle, the latest if a run was repeated.
        const byBattle = new Map<number, (typeof mine)[number]>();
        for (const s of mine) {
          const prev = byBattle.get(s.battle);
          if (!prev || s.lockedAt > prev.lockedAt) byBattle.set(s.battle, s);
        }
        if (byBattle.size !== BATTLES) return;
        const blobs = [...byBattle.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s.png);
        const blob = await composeMontage(blobs, r.sevenHeadline);
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setPng({ url, blob });
      } catch {
        /* no stills on this device, or no canvas: the section simply does not render */
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [poolAddress, state, r.sevenHeadline]);

  const share = useCallback(async () => {
    if (!png) return;
    const file = new File([png.blob], 'blotto-seven.png', { type: 'image/png' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: r.shareSevenText });
        return;
      }
    } catch {
      /* fall through to the download path (user cancel included) */
    }
    const a = document.createElement('a');
    a.href = png.url;
    a.download = 'blotto-seven.png';
    a.click();
    try {
      await navigator.clipboard.writeText(r.shareSevenText);
      setNote(COPY.battle.shareFallbackCopied);
    } catch {
      setNote(null);
    }
  }, [png, r.shareSevenText]);

  const postOnX = useCallback(() => {
    if (!png) return;
    const a = document.createElement('a');
    a.href = png.url;
    a.download = 'blotto-seven.png';
    a.click();
    window.open(
      `https://x.com/intent/post?text=${encodeURIComponent(r.shareSevenText)}`,
      '_blank',
      'noopener,noreferrer'
    );
    setNote(COPY.battle.shareXNote);
  }, [png, r.shareSevenText]);

  if (!png) return null;

  return (
    <Card className="mb-6 flex flex-col items-center gap-3 p-5" data-testid="share-seven">
      <h2 className="font-display text-[22px] leading-7 font-bold text-ink">{r.shareSevenTitle}</h2>
      {/* eslint-disable-next-line @next/next/no-img-element -- object-URL preview of a canvas composition */}
      <img src={png.url} alt={r.sevenAlt} className="w-full max-w-sm rounded-2xl" />
      <div className="flex flex-wrap justify-center gap-2">
        <Button intent="prize" onClick={share}>
          {COPY.battle.share}
        </Button>
        <Button intent="quiet" onClick={postOnX}>
          <XMark size={16} />
          <span className="ml-2">{COPY.battle.shareX}</span>
        </Button>
      </div>
      <p className="max-w-prose text-center text-[12px] leading-5 text-ink-muted">{note ?? r.shareSevenLine}</p>
    </Card>
  );
}
