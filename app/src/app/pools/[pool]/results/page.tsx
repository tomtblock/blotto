/*
 * Results + ranking (roadmap 3.5; restyled by v3 D2): the committed payout
 * list staged as a reveal (results-reveal.tsx), the paid-automatically
 * state (R10 — no claim step), escrow copy where a share is held, and the
 * Verify path always on screen.
 */
import { notFound } from 'next/navigation';
import { COPY } from '@/copy';
import { indexerApi } from '@/data/api';
import { lamportsToSol } from '@/data/format';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';
import { Card } from '@/components/ui/card';
import { ResultsReveal, VerifyAlways, type RevealRow } from './results-reveal';

export default async function ResultsPage({ params }: { params: Promise<{ pool: string }> }) {
  const { pool: poolId } = await params;
  const api = indexerApi();
  const pool = await api.getPool(poolId);
  if (!pool) notFound();
  const [results, payouts, entries] = await Promise.all([
    api.getResults(poolId),
    api.getPayouts(poolId),
    api.getEntries(poolId),
  ]);
  // D3-B: the committed list is keyed by seat; a tie group's members split
  // the combined prize, so the paid set can exceed 16 rows. Rank labels are
  // not on-chain — the verify page recomputes them from the published data.
  const payoutBySeat = new Map(payouts.map((p) => [p.seat, p]));
  const entryBySeat = new Map(entries.map((e) => [e.idx, e]));
  const rows: RevealRow[] = [...results]
    .sort((a, b) =>
      BigInt(a.amount) < BigInt(b.amount) ? 1 : BigInt(a.amount) > BigInt(b.amount) ? -1 : a.seat - b.seat
    )
    .map((r) => {
      const payout = payoutBySeat.get(r.seat);
      const entry = entryBySeat.get(r.seat);
      const held = Boolean(payout && payout.escrowed && entry?.escrow_settled !== 'released');
      return {
        seat: r.seat,
        player: entry?.player ?? '',
        playerShort: entry ? `${entry.player.slice(0, 8)}…` : '—',
        amountSol: held ? null : lamportsToSol(r.amount),
      };
    });

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-24">
        <header className="mb-5 flex items-baseline gap-3">
          <h1 className="font-display text-[24px] font-bold text-ink">
            Pool #{pool.id} — results
          </h1>
        </header>
        {pool.state === 'Paid' && (
          <p className="mb-4 text-[13px] leading-5 text-ink-muted">
            {COPY.results.paidAutomatically}
          </p>
        )}
        {results.length === 0 ? (
          <Card className="mb-5 flex flex-col gap-2 p-6">
            <p className="text-[17px] font-medium text-ink">Results are not committed yet.</p>
            <p className="max-w-prose text-[13px] leading-5 text-ink-muted">
              When the pool seals, the pool secret is published and results are committed
              on-chain — this page fills in at that moment, and everything on it can be
              recomputed on the Verify page.
            </p>
          </Card>
        ) : (
          <>
            <Card className="mb-4 p-1">
              <ResultsReveal rows={rows} />
            </Card>
            <p className="mb-5 max-w-prose text-[13px] leading-5 text-ink-muted">
              {COPY.results.tieNote}
            </p>
          </>
        )}
        <VerifyAlways pool={pool.pool} />
      </main>
      <TabBar />
    </>
  );
}
