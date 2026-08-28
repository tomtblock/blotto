/*
 * The pool page (roadmap 3.2; restyled by v3 D2): the fixture in full — the
 * seat ring, the fixed prize pool, the 72h clock, the published prize table
 * — and the §8.6 "decisions are final" statement ABOVE the enter control,
 * which is a legal-position requirement, not layout taste.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { COPY } from '@/copy';
import { indexerApi, live } from '@/data/api';
import { lamportsToSol, prizeForRank } from '@/data/format';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';
import { LiveDataUnavailable } from '@/components/shell/live-unavailable';
import { Card } from '@/components/ui/card';
import { Stat } from '@/components/ui/stat';
import { PrizeTable } from '@/components/ui/prize-table';
import { Countdown } from '@/components/ui/countdown';
import { LivePoolRing } from '@/components/pool/live-pool-ring';
import { buttonClasses } from '@/components/ui/button';

const BANDS = [
  { label: '1st', rank: 1 },
  { label: '2nd', rank: 2 },
  { label: '3rd', rank: 3 },
  { label: '4th', rank: 4 },
  { label: '5th–8th', rank: 5 },
  { label: '9th–16th', rank: 9 },
];

export default async function PoolPage({ params }: { params: Promise<{ pool: string }> }) {
  const { pool: poolId } = await params;
  // SSR outage guard: unreachable indexer ≠ nonexistent pool.
  const poolLive = await live(() => indexerApi().getPool(poolId));
  if (!poolLive.ok) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-24">
          <LiveDataUnavailable />
        </main>
        <TabBar />
      </>
    );
  }
  const pool = poolLive.value;
  if (!pool) notFound();
  const open = pool.state === 'Open';

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-24">
        <header className="mb-5 flex items-baseline gap-3">
          <h1 className="font-display text-[24px] font-bold text-ink">Pool #{pool.id}</h1>
          <span className="rounded-full border border-line px-2.5 py-0.5 text-[12px] uppercase tracking-[0.1em] text-ink-muted">
            {pool.state}
          </span>
          <Link
            href={`/verify?pool=${pool.pool}`}
            className="link-draw ml-auto text-[13px] text-ink-muted hover:text-ink"
          >
            Verify this pool
          </Link>
        </header>

        <Card live={open} className="mb-5 p-5">
          <div className="flex flex-wrap items-center gap-5">
            {/* The room's heartbeat: real occupancy, WARMTH at true
                intensity, one riser per real entry. */}
            <LivePoolRing pool={pool} size={116} riser={open} />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <Stat
                label={COPY.pool.prizeTableTitle}
                value={lamportsToSol(pool.pot_lamports)}
                unit="SOL"
                tone="prize"
              />
              <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                <Stat label="Entry" value={lamportsToSol(pool.entry_lamports)} unit="SOL" />
                {open && (
                  <Countdown deadlineUnix={pool.fill_deadline} label={COPY.pool.fillDeadline} />
                )}
              </div>
            </div>
          </div>
        </Card>

        <Card className="mb-5 p-5">
          <h2 className="mb-3 text-[12px] uppercase tracking-[0.14em] text-ink-muted">
            {COPY.pool.prizeTableTitle}
          </h2>
          <PrizeTable
            caption={COPY.pool.prizeTableTitle}
            rows={BANDS.map((b) => ({
              position: b.label,
              amountSol: lamportsToSol(prizeForRank(pool.pot_lamports, b.rank)),
              rank: b.rank,
            }))}
          />
        </Card>

        <section className="mb-6 flex flex-col gap-2 text-[13px] leading-5 text-ink-muted">
          <p>{COPY.pool.sealed}</p>
          <p>{COPY.pool.refundRule}</p>
          <p>
            <Link href="/rules" className="underline underline-offset-2 hover:text-ink">
              {COPY.rules.title}
            </Link>
          </p>
        </section>

        {open ? (
          <section className="flex flex-col gap-3">
            {/* PID §8.6: above the Enter control. Do not move it below. */}
            <p className="text-[14px] font-medium leading-5 text-ink">
              {COPY.pool.decisionsFinal}
            </p>
            <Link href={`/play?pool=${pool.pool}`} className={buttonClasses('primary', 'lg') + ' w-full'}>
              {COPY.pool.enter}
            </Link>
          </section>
        ) : (
          <Link
            href={`/pools/${pool.pool}/results`}
            className={buttonClasses('secondary', 'md') + ' w-full'}
          >
            Results
          </Link>
        )}
      </main>
      <TabBar />
    </>
  );
}
