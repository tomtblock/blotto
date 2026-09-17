'use client';

/*
 * The pass — the moment after the entry confirms (2026-09-13; the
 * character came off it 2026-09-15).
 *
 * The SHARE is offered only once the network has confirmed the entry: this
 * component renders in the machine's `card` beat, which is reachable only
 * after `tx_confirmed`. What it shares is the pass — the seat and the pool.
 * Nothing sealed (see compose-pass.ts for why the seven-Blott montage that
 * used to be offered before signing was the sealed allocation in
 * silhouette).
 *
 * THE DRAWN CLASS IS NOT ON THE PASS. Until 2026-09-15 this card named the
 * class, its rarity, and glowed in the class hue behind the mascot. The
 * founder's instruction of 2026-09-14 — the rarity assignment is not
 * broadcast to players — took all three off; the one surface that shows
 * rarity is the profile, with `COPY.profile.rarityCaveat` beside it. The
 * `RevealVisual` this renders from no longer carries a class at all, so
 * the card cannot show one even by accident.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { COPY } from '@/copy';
import { XMark } from '@/wallet/wallet-icons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { BlottSprite, blottPoseUrl } from '@/components/blott/BlottSprite';
import { truncateAddress } from '@/wallet/types';
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
 * The pass as a PNG, composed once on mount. A bonus: if the canvas fails
 * this stays null and the share controls simply do not appear; nothing else
 * on the screen depends on it. Shared by the page-layout card and the
 * sealed column beside the blender (round four, entered-panel.tsx).
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
        /* no share controls; the pass on screen is unaffected */
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

export function PassCard({
  entryIndex,
  asset,
  poolNumber,
  onDone,
}: {
  entryIndex: number;
  asset: string;
  /** The pool's number (#11), for the card and the share line. Absent only
   *  when the page could not read the pool; the card then omits it. */
  poolNumber?: string | number;
  onDone: () => void;
}) {
  const png = usePassImage(entryIndex, poolNumber);
  const [note, setNote] = useState<string | null>(null);
  const r = COPY.reveal;
  const poolLine = passPoolLine(poolNumber);
  const shareText = passShareTextFor(poolNumber);

  const share = useCallback(async () => {
    if (!png) return;
    const file = new File([png.blob], 'blotto-pass.png', { type: 'image/png' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: shareText });
        return;
      }
    } catch {
      /* fall through to the download path (user cancel included) */
    }
    const a = document.createElement('a');
    a.href = png.url;
    a.download = 'blotto-pass.png';
    a.click();
    try {
      await navigator.clipboard.writeText(shareText);
      setNote(r.passShareFallbackCopied);
    } catch {
      setNote(null);
    }
  }, [png, shareText, r]);

  const postOnX = useCallback(() => {
    if (!png) return;
    openXWithPass(png, shareText);
    setNote(r.passShareXNote);
  }, [png, shareText, r]);

  return (
    <section className="animate-reveal flex w-full max-w-md flex-col items-center gap-5" aria-live="polite">
      <h2 className="font-display text-[28px] leading-8 font-extrabold text-ink">{r.cardTitle}</h2>

      <Card tone="light" className="w-full p-6 text-center" data-testid="pass-card">
        <p className="font-mono text-[11px] tracking-[0.16em] uppercase text-brand-berry/70">
          {COPY.shell.title} · {poolLine}
        </p>
        <div className="relative mx-auto mt-2 h-44 w-44">
          <div aria-hidden className="absolute inset-4 rounded-full bg-brand-pale-pink opacity-70 blur-2xl" />
          <BlottSprite pose="cheer" size={176} className="relative" />
        </div>
        <p className="mt-1 font-display text-[44px] leading-none font-extrabold text-brand-berry">
          {r.passEntered}
        </p>
        <p className="mt-3 text-[17px] font-semibold text-brand-berry">{r.cardSeat(entryIndex)}</p>
        <p className="mt-1 font-mono text-[11px] text-brand-berry/60">{truncateAddress(asset)}</p>
      </Card>

      {png ? (
        <div className="flex w-full flex-col items-center gap-2">
          <p className="text-[12px] uppercase tracking-[0.14em] text-ink-muted">{r.passShareTitle}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button intent="prize" onClick={share} data-testid="share-pass">
              {r.passShare}
            </Button>
            <Button intent="quiet" onClick={postOnX} data-testid="share-pass-x">
              <XMark size={16} />
              <span className="ml-2">{r.passShareX}</span>
            </Button>
          </div>
          <p className="max-w-prose text-center text-[12px] text-ink-muted">{note ?? r.passShareLine}</p>
        </div>
      ) : null}

      <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
        <Button size="lg" onClick={onDone} data-testid="pass-continue">
          {r.cardDone}
        </Button>
        <Link
          href="/"
          className="inline-flex h-14 items-center justify-center rounded-full border border-white/20 px-8 text-[15px] text-ink transition-colors hover:border-brand hover:text-brand"
        >
          {COPY.shell.nav.backToHome}
        </Link>
      </div>
    </section>
  );
}
