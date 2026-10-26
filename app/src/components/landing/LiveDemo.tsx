'use client';

/*
 * The landing's live demo (master prompt D): fully working, no wallet, no
 * stakes — the toy IS the pitch. Founder 2026-09-24: the toy is the BOARD
 * — the same map, troops, stepper and clock the run uses, so the landing
 * teaches the exact object a player plays on. (The dial "practice machine"
 * it replaced was removed on 2026-09-24.)
 *
 * The demo state is local and thrown away — nothing a visitor does here
 * touches storage or the network. In demo mode the BoardFlow draws no
 * seal and no leave guard; the review offers "Try again".
 *
 * V3 (founder 2026-09-27): beside the board, "Enter for real" — straight
 * to the start of the easy flow, the open easy pool the page found. Absent
 * one, the key is not drawn (nothing on the landing invents a pool).
 *
 * THE BOARD LOADS WHEN THE READER NEARS IT (2026-10-26, D-E12 page speed).
 * The demo sits two to three screens down the page, but rendering it with
 * the page put its code, its five troop sprites and its display font on
 * the wire in the same first second as the hero — on a phone connection,
 * that is the second Lighthouse charged the landing for. It now mounts one
 * screen before it scrolls into view (or at once, from the hero's "Try the
 * board" link), in a space held at its height so nothing below it moves.
 * Rejected: `content-visibility: auto`, which skips the board's rendering
 * but still sends its sprites, code and font with the page.
 */

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { COPY } from '@/copy';

/* The board's height, measured on the 2026-10-26 fixture build: 644 px at
 * 375–412 px wide, 652 px at 768, 697 px at 1280. Held while its code loads. */
const BOARD_SPACE = 'min-h-[650px]';

const BoardFlow = dynamic(() => import('@/battle/components/board/BoardFlow').then((m) => m.BoardFlow), {
  ssr: false,
  loading: () => <div className={BOARD_SPACE} />,
});

export function LiveDemo({ title, enterHref }: { title: string; enterHref: string | null }) {
  const slot = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = slot.current;
    if (!el || near) return;
    // One screen of lead: the board is drawn before the reader arrives.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setNear(true);
      },
      { rootMargin: '100% 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  return (
    <div className="flex flex-col gap-4" data-testid="board-demo">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[28px] font-extrabold leading-8 text-brand-berry sm:text-[34px] sm:leading-10">{title}</h2>
        {enterHref ? (
          <Link
            href={enterHref}
            data-testid="demo-enter"
            className="key-prize flex h-12 items-center justify-center rounded-full bg-brand-yellow px-7 font-display text-[16px] font-extrabold uppercase tracking-wide text-brand-berry hover:bg-brand-cream"
          >
            {COPY.landing.enterForReal}
          </Link>
        ) : null}
      </div>
      <div ref={slot} className={near ? undefined : BOARD_SPACE}>
        {near ? <BoardFlow mode="easy" demo onConfirm={() => {}} /> : null}
      </div>
      {/* Full berry: at 80% it is 3.7:1 on the page pink, under the 4.5:1 floor (D-E12). */}
      <p className="max-w-prose text-[13px] leading-5 text-brand-berry">{COPY.landing.demoBoardHint}</p>
    </div>
  );
}
