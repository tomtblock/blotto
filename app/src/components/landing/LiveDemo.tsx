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
 */

import { COPY } from '@/copy';
import { BoardFlow } from '@/battle/components/board/BoardFlow';

export function LiveDemo() {
  return (
    <div className="flex flex-col gap-3" data-testid="board-demo">
      <BoardFlow mode="easy" demo onConfirm={() => {}} />
      <p className="max-w-prose text-[13px] leading-5 text-ink-muted">{COPY.landing.demoBoardHint}</p>
    </div>
  );
}
