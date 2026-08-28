/*
 * The proof band (UI constitution 6.1 Act II): one quiet horizontal band,
 * two instruments — the winners drift and the paid-out counter — both
 * driven by on-chain data only, both linking into Verify. The refund rule
 * and pre-funding are stated at the same visual weight as the payouts:
 * nothing builds first-entry trust faster than the operator stating what
 * it gives back.
 *
 * Honest empty states: with no Paid pools yet there is no drift and no
 * counter — a plain sentence says so, and the pre-funding line stands on
 * its own. The Adjudicator does not pretend.
 */
import Link from 'next/link';
import { COPY } from '@/copy';
import { lamportsToSol } from '@/data/format';
import type { ProofBand as ProofBandData } from '@/data/winners';
import { WinnersCard } from '@/components/winners/winners-card';
import { WinnersDrift } from '@/components/winners/winners-drift';
import { SettledCounter } from '@/components/ui/settled-counter';

export function ProofBandSection({ data }: { data: ProofBandData }) {
  const hasHistory = data.cards.length > 0;
  return (
    <section className="mt-10" aria-label={COPY.proof.winnersTitle}>
      <h2 className="mb-3 text-[12px] uppercase tracking-[0.14em] text-ink-muted">
        {COPY.proof.winnersTitle}
      </h2>

      <WinnersDrift cards={data.cards.map((c) => <WinnersCard key={c.pool} card={c} />)} />

      <div className="mt-5 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 rounded-2xl border border-line bg-raised p-5">
        {hasHistory ? (
          <div className="flex flex-col gap-1">
            <SettledCounter
              value={lamportsToSol(data.paidToDateLamports)}
              unit="SOL"
              label={COPY.proof.paidToDate}
            />
            <Link href="/verify" className="link-draw w-fit text-[12px] font-medium text-brand">
              {COPY.proof.recompute}
            </Link>
          </div>
        ) : null}
        <div className="flex max-w-[44ch] flex-col gap-1.5">
          <p className="text-[14px] font-medium text-ink">{COPY.proof.preFunded}</p>
          <p className="text-[13px] leading-5 text-ink-muted">{COPY.proof.split}</p>
          <p className="text-[13px] leading-5 text-ink-muted">{COPY.pool.refundRule}</p>
        </div>
      </div>
    </section>
  );
}
