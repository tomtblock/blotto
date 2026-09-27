'use client';

/*
 * The pass — what the success screen (entered-panel.tsx) shows and shares
 * once the entry confirms (2026-09-13; the character came off it 2026-09-15;
 * the page-layout card that once lived here went with the V2 review of
 * 2026-09-27 — the success screen is the only pass on screen now).
 *
 * The SHARE is offered only once the network has confirmed the entry: the
 * success screen renders in the machine's `card` beat, which is reachable
 * only after `tx_confirmed`. What it shares is the pass — the seat and the
 * pool. Nothing sealed (see compose-pass.ts for why the seven-Blott montage
 * that used to be offered before signing was the sealed allocation in
 * silhouette).
 *
 * THE DRAWN CLASS IS NOT ON THE PASS. Until 2026-09-15 the card named the
 * class, its rarity, and glowed in the class hue behind the mascot. The
 * founder's instruction of 2026-09-14 — the rarity assignment is not
 * broadcast to players — took all three off; since 2026-09-27 no surface
 * shows rarity at all (the profile's collection was removed too). The
 * `RevealVisual` this renders from no longer carries a class at all, so
 * the card cannot show one even by accident.
 */

import { useEffect, useState } from 'react';
import { COPY } from '@/copy';
import { blottPoseUrl } from '@/components/blott/BlottSprite';
import { composePassCard } from './compose-pass';

export interface PassImage {
  url: string;
  blob: Blob;
}

/** The pool line on the pass, or the wordmark when the page could not read the pool. */
export function passPoolLine(poolNumber?: string | number): string {
  return poolNumber !== undefined ? COPY.reveal.passPool(poolNumber) : COPY.shell.title;
}

/** The line that goes with the pass when it is posted. */
export function passShareTextFor(poolNumber?: string | number): string {
  return poolNumber !== undefined ? COPY.reveal.passShareText(poolNumber) : COPY.shell.tagline;
}

/**
 * The pass as a PNG, composed once on mount. If the canvas fails this stays
 * null and the share control stays disabled; nothing else on the screen
 * depends on it.
 */
export function usePassImage(entryIndex: number, poolNumber?: string | number): PassImage | null {
  const [png, setPng] = useState<PassImage | null>(null);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const r = COPY.reveal;
    (async () => {
      try {
        const blob = await composePassCard({
          seatLine: r.cardSeat(entryIndex),
          poolLine: passPoolLine(poolNumber),
          headline: r.passEntered,
          wordmark: COPY.shell.title,
          footer: r.passFooter,
          spriteUrl: blottPoseUrl('cheer'),
        });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPng({ url: objectUrl, blob });
      } catch {
        /* no share control; the pass on screen is unaffected */
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [entryIndex, poolNumber]);
  return png;
}

/* The web intent takes text only, so the image downloads alongside for the
 * player to attach. */
export function openXWithPass(png: PassImage, shareText: string): void {
  const a = document.createElement('a');
  a.href = png.url;
  a.download = 'blotto-pass.png';
  a.click();
  window.open(
    `https://x.com/intent/post?text=${encodeURIComponent(shareText)}`,
    '_blank',
    'noopener,noreferrer'
  );
}
