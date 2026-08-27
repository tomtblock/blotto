/*
 * Results + ranking (roadmap 3.5): rank, score, the full table, the
 * paid-automatically state (R10 — no claim step), escrow copy where a share
 * is held.
 */
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { COPY } from '@/copy';
import { indexerApi } from '@/data/api';
import { lamportsToSol } from '@/data/format';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';

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
  const rows = [...results].sort(
    (a, b) => (BigInt(a.amount) < BigInt(b.amount) ? 1 : BigInt(a.amount) > BigInt(b.amount) ? -1 : a.seat - b.seat)
  );

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <header className="mb-6 flex items-baseline gap-4">
          <h1 className="text-2xl">Pool #{pool.id} — results</h1>
          <Link href={`/verify?pool=${pool.pool}`} className="ml-auto underline">
            Verify
          </Link>
        </header>
        {pool.state === 'Paid' && <p className="mb-4 text-sm opacity-80">{COPY.results.paidAutomatically}</p>}
        {results.length === 0 ? (
          <p className="opacity-70">Results are not committed yet.</p>
        ) : (
          <>
            <p className="mb-4 text-sm opacity-70">{COPY.results.tieNote}</p>
            <table className="w-full text-left">
              <thead>
                <tr className="text-sm opacity-60">
                  <th className="py-2">Seat</th>
                  <th>Player</th>
                  <th className="text-right">Prize</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const payout = payoutBySeat.get(r.seat);
                  const entry = entryBySeat.get(r.seat);
                  return (
                    <tr key={r.seat} className="border-t">
                      <td className="py-2 font-mono">{r.seat}</td>
                      <td className="font-mono text-sm">
                        {entry ? `${entry.player.slice(0, 8)}…` : '—'}
                      </td>
                      <td className="text-right font-mono">
                        {payout && payout.escrowed && entry?.escrow_settled !== 'released' ? (
                          <span title={COPY.results.escrowHeld}>held</span>
                        ) : (
                          `${lamportsToSol(r.amount)} SOL`
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </main>
      <TabBar />
    </>
  );
}
