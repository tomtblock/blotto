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
  const payoutByRank = new Map(payouts.map((p) => [p.rank, p]));
  const entryByPlayer = new Map(entries.map((e) => [e.player, e]));

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
          <table className="w-full text-left">
            <thead>
              <tr className="text-sm opacity-60">
                <th className="py-2">Rank</th>
                <th>Player</th>
                <th className="text-right">Prize</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const payout = payoutByRank.get(r.rank);
                const entry = entryByPlayer.get(r.player);
                return (
                  <tr key={r.rank} className="border-t">
                    <td className="py-2 font-mono">#{r.rank}</td>
                    <td className="font-mono text-sm">{r.player.slice(0, 8)}…</td>
                    <td className="text-right font-mono">
                      {payout ? (
                        payout.escrowed && entry?.escrow_settled !== 'released' ? (
                          <span title={COPY.results.escrowHeld}>held</span>
                        ) : (
                          `${lamportsToSol(payout.amount)} SOL`
                        )
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </main>
      <TabBar />
    </>
  );
}
