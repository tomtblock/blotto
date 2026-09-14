'use client';

/*
 * The character pass — the moment after the egg (2026-09-13).
 *
 * Before this change the pass was a bordered box with four lines of text,
 * and the SHARE lived earlier, on the review screen, before the player had
 * signed anything — and what it shared was a picture of the seven Blotts,
 * which is the sealed allocation in silhouette (see compose-pass.ts). Both
 * are fixed here: the share is offered only once the network has confirmed
 * the entry (this component renders in the machine's `card` beat, which is
 * reachable only after `tx_confirmed`), and what it shares is the pass —
 * the look drawn, the seat, the pool. Nothing sealed.
 *
 * The pass is a brand-layer object: cream card on the plum page, the
 * character large, the class accent as a halo behind it. The class line and
 * the no-effect sentence stay, because the pass must never read as an
 * advantage (PID §8.4).
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { COPY } from '@/copy';
import * as revealCopy from '@/reveal/copy';
import { XMark } from '@/wallet/wallet-icons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { BlottSprite, blottPoseUrl } from '@/components/blott/BlottSprite';
import { classColorToken } from '@/reveal/class-colour';
import type { RevealClass } from '@/reveal/types';
import { truncateAddress } from '@/wallet/types';
import { composePassCard } from './compose-pass';

export function PassCard({
  classIndex,
  entryIndex,
  asset,
  poolNumber,
  onDone,
}: {
  classIndex: RevealClass;
  entryIndex: number;
  asset: string;
  /** The pool's number (#11), for the card and the share line. Absent only
   *  when the page could not read the pool; the card then omits it. */
  poolNumber?: string | number;
  onDone: () => void;
}) {
  const [png, setPng] = useState<{ url: string; blob: Blob } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const r = COPY.reveal;
  const poolLine = poolNumber !== undefined ? r.passPool(poolNumber) : COPY.shell.title;
  const shareText = poolNumber !== undefined ? r.passShareText(poolNumber) : COPY.shell.tagline;

  // Compose once, on mount. The pass is a bonus: if the canvas fails the
  // buttons simply do not appear, and nothing else on the screen depends on it.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const blob = await composePassCard({
          classIndex,
          className: r.classNames[classIndex],
          rarityName: r.rarityNames[classIndex],
          rarityLine: r.rarityOf(r.rarityCounts[classIndex]),
          seatLine: r.cardSeat(entryIndex),
          poolLine,
          headline: r.passEntered,
          wordmark: COPY.shell.title,
          footer: r.passFooter,
          spriteUrl: blottPoseUrl('cheer'),
        });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPng({ url: objectUrl, blob });
      } catch {
        /* no share buttons; the pass on screen is unaffected */
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one pass per outcome
  }, [classIndex, entryIndex, poolNumber]);

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

  /* The web intent takes text only, so the image downloads alongside for
   * the player to attach. */
  const postOnX = useCallback(() => {
    if (!png) return;
    const a = document.createElement('a');
    a.href = png.url;
    a.download = 'blotto-pass.png';
    a.click();
    window.open(
      `https://x.com/intent/post?text=${encodeURIComponent(shareText)}`,
      '_blank',
      'noopener,noreferrer'
    );
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
          {/* The class accent as a halo — the look, and only the look. */}
          <div
            aria-hidden
            className="absolute inset-4 rounded-full opacity-60 blur-2xl"
            style={{ background: `var(${classColorToken(classIndex)})` }}
          />
          <BlottSprite pose="cheer" size={176} className="relative" />
        </div>
        <p className="mt-1 font-display text-[44px] leading-none font-extrabold text-brand-berry">
          {r.passEntered}
        </p>
        <p className="mt-2 font-display text-[26px] leading-7 font-bold uppercase tracking-wide text-brand-berry">
          {r.classNames[classIndex]}
        </p>
        <p className="mt-1 text-[13px] text-brand-deep-magenta">
          {r.rarityNames[classIndex]} · {r.rarityOf(r.rarityCounts[classIndex])}
        </p>
        <p className="mt-2 text-[15px] font-semibold text-brand-berry">{r.cardSeat(entryIndex)}</p>
        <p className="mt-1 font-mono text-[11px] text-brand-berry/60">{truncateAddress(asset)}</p>
      </Card>

      <p className="max-w-prose text-center text-[13px] leading-5 text-ink-muted">{revealCopy.EGG_NO_EFFECT}</p>

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
