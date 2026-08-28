/*
 * WinnersCard (UI constitution PART 5.7): one completed tournament. Always
 * carries its context line ("n of 64 paid") — a winners-only wall is an
 * implied claim — and always links to the tournament's recomputable
 * result. Identity is the truncated wallet (chosen handles arrive with a
 * later profile feature; the Adjudicator does not invent names).
 */
import Link from 'next/link';
import { COPY } from '@/copy';
import { lamportsToSol } from '@/data/format';
import type { WinnerCard as WinnerCardData } from '@/data/winners';

function shortWallet(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function WinnersCard({ card }: { card: WinnerCardData }) {
  const tied = card.firstPlayers.length > 1;
  return (
    <article className="flex w-64 shrink-0 flex-col gap-1.5 rounded-2xl border border-line bg-raised p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] uppercase tracking-[0.1em] text-ink-muted">
          {COPY.pool.tierEntry(lamportsToSol(card.entryLamports))}
        </span>
        <span className="text-[12px] text-ink-muted">#{card.poolId}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] text-ink-muted">{COPY.proof.firstPlace}</span>
        <span className="font-mono text-[14px] text-ink">
          {tied ? COPY.proof.tiedFirst(card.firstPlayers.length) : shortWallet(card.firstPlayers[0])}
        </span>
      </div>
      {/* Prize amber: worn by the paid amount and nothing else. */}
      <div className="tnum font-display text-[24px] font-bold leading-7 text-prize">
        {lamportsToSol(card.firstAmountLamports)} SOL
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-ink-muted">{COPY.proof.paidContext(card.paidCount)}</span>
        <Link
          href={`/verify?pool=${card.pool}`}
          className="link-draw text-[12px] font-medium text-brand"
        >
          {COPY.proof.verifyThis}
        </Link>
      </div>
    </article>
  );
}
