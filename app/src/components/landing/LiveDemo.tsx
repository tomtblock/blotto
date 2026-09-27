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
 */

import Link from 'next/link';
import { COPY } from '@/copy';
import { BoardFlow } from '@/battle/components/board/BoardFlow';

export function LiveDemo({ title, enterHref }: { title: string; enterHref: string | null }) {
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
      <BoardFlow mode="easy" demo onConfirm={() => {}} />
      <p className="max-w-prose text-[13px] leading-5 text-brand-berry/80">{COPY.landing.demoBoardHint}</p>
    </div>
  );
}
