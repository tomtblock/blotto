/*
 * The pool page (roadmap 3.2): tier, entry, entrants/64, the 72h countdown,
 * the prize table, the rules summary — and the §8.6 "decisions are final"
 * statement ABOVE the enter control, which is a legal-position requirement,
 * not layout taste.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { COPY } from '@/copy';
import { indexerApi } from '@/data/api';
import { lamportsToSol, prizeForRank } from '@/data/format';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';
import { Countdown } from './countdown';

export default async function PoolPage({ params }: { params: Promise<{ pool: string }> }) {
  const { pool: poolId } = await params;
  const pool = await indexerApi().getPool(poolId);
  if (!pool) notFound();
  const bands = [
    { label: '1st', ranks: [1] },
    { label: '2nd', ranks: [2] },
    { label: '3rd', ranks: [3] },
    { label: '4th', ranks: [4] },
    { label: '5th–8th', ranks: [5] },
    { label: '9th–16th', ranks: [9] },
  ];
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <header className="mb-6 flex items-baseline gap-4">
          <h1 className="text-2xl">Pool #{pool.id}</h1>
          <span className="font-mono text-xl">{lamportsToSol(pool.entry_lamports)} SOL</span>
          <span className="ml-auto rounded border px-2 py-0.5 text-sm">{pool.state}</span>
        </header>

        <section className="mb-6 grid grid-cols-2 gap-4">
          <div className="rounded border p-4">
            <div className="text-sm opacity-60">{COPY.pool.entrantsOf(pool.entrants)}</div>
            <div className="mt-1 h-2 overflow-hidden rounded bg-[var(--color-border,#333)]">
              <div
                className="h-full bg-[var(--color-accent,#7c5cff)]"
                style={{ width: `${(pool.entrants / 64) * 100}%` }}
              />
            </div>
          </div>
          <div className="rounded border p-4">
            <div className="text-sm opacity-60">{COPY.pool.fillDeadline}</div>
            <Countdown deadlineUnix={pool.fill_deadline} />
          </div>
        </section>

        <section className="mb-6 rounded border p-4">
          <h2 className="mb-3">{COPY.pool.prizeTableTitle}</h2>
          <table className="w-full text-left">
            <tbody>
              {bands.map((b) => (
                <tr key={b.label}>
                  <td className="py-1 opacity-70">{b.label}</td>
                  <td className="py-1 text-right font-mono">
                    {lamportsToSol(prizeForRank(pool.entry_lamports, b.ranks[0]))} SOL
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mb-6 flex flex-col gap-2 text-sm opacity-80">
          <p>{COPY.pool.sealed}</p>
          <p>{COPY.pool.refundRule}</p>
          <p>
            <Link href="/rules" className="underline">
              Rules
            </Link>
            {' · '}
            <Link href={`/verify?pool=${pool.pool}`} className="underline">
              Verify this pool
            </Link>
          </p>
        </section>

        {pool.state === 'Open' ? (
          <section className="flex flex-col gap-3">
            {/* PID §8.6: above the Enter control. Do not move it below. */}
            <p className="text-sm font-medium">{COPY.pool.decisionsFinal}</p>
            <Link
              href={`/play?pool=${pool.pool}`}
              className="rounded bg-[var(--color-accent,#7c5cff)] px-6 py-3 text-center text-white"
            >
              {COPY.pool.enter}
            </Link>
          </section>
        ) : (
          <Link href={`/pools/${pool.pool}/results`} className="underline">
            Results
          </Link>
        )}
      </main>
      <TabBar />
    </>
  );
}
