/*
 * The pool page (roadmap 3.2; restyled by v3 D2; D-E2/D-E4 2026-09-06,
 * option A 2026-09-07): the fixture in full — the seat ring, the fixed
 * prize pool and the one-line rule for who receives it, the ONE clock (the
 * fill deadline set at open, 12 h at launch, derived from the server's
 * time) — and the §8.6 "decisions are final" statement ABOVE the enter
 * control, which is a legal-position requirement, not layout taste.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DEFAULT_FILL_DEADLINE_SECS, MIN_SEATS, TIER_POT_LAMPORTS } from '@blotto/scoring';
import { COPY } from '@/copy';
import { indexerApi, live } from '@/data/api';
import { lamportsToSol } from '@/data/format';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';
import { LiveDataUnavailable } from '@/components/shell/live-unavailable';
import { Card } from '@/components/ui/card';
import { Stat } from '@/components/ui/stat';
import { ProgressRing } from '@/components/ui/progress-ring';
import { Countdown } from '@/components/ui/countdown';

const MIN_SEATS_N = Number(MIN_SEATS);
const FILL_HOURS = Number(DEFAULT_FILL_DEADLINE_SECS / 3600n);

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
  // D-E1 §1.4: a pool carries the pot it OPENED with; when the launch
  // table has since moved, say the guarantee rather than look like a cut.
  const potDiffers =
    pool.tier >= 0 &&
    pool.tier < TIER_POT_LAMPORTS.length &&
    BigInt(pool.pot_lamports) !== TIER_POT_LAMPORTS[pool.tier];

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
            className="ml-auto text-[13px] text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            Verify this pool
          </Link>
        </header>

        <Card live={open} className="mb-5 p-5">
          {potDiffers && (
            <p className="mb-3 text-[13px] leading-5 text-ink-muted">
              {COPY.pool.potFixedAtOpen}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-5">
            <ProgressRing
              value={pool.entrants}
              total={64}
              size={104}
              label={`${pool.entrants} of 64 seats filled`}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <Stat
                label={COPY.pool.prizeLabel}
                value={lamportsToSol(pool.pot_lamports)}
                unit="SOL"
                tone="prize"
              />
              <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                <Stat label="Entry" value={lamportsToSol(pool.entry_lamports)} unit="SOL" />
                {open && (
                  <Countdown
                    deadlineUnix={pool.fill_deadline}
                    serverTimeUnix={pool.server_time}
                    label={COPY.pool.fillDeadline}
                  />
                )}
              </div>
            </div>
          </div>
        </Card>

        <section className="mb-6 flex flex-col gap-2 text-[13px] leading-5 text-ink-muted">
          <p>{COPY.pool.prizeRule}</p>
          <p>{COPY.pool.sealed}</p>
          <p>{COPY.pool.refundRule(MIN_SEATS_N, FILL_HOURS)}</p>
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
            <Link
              href={`/play?pool=${pool.pool}`}
              className="flex h-14 items-center justify-center rounded-xl bg-brand text-[17px] font-semibold text-(--color-base) transition-colors hover:bg-brand-hot"
            >
              {COPY.pool.enter}
            </Link>
          </section>
        ) : (
          <Link
            href={`/pools/${pool.pool}/results`}
            className="flex h-12 items-center justify-center rounded-xl border border-line text-[15px] font-medium text-ink transition-colors hover:border-brand hover:text-brand"
          >
            Results
          </Link>
        )}
      </main>
      <TabBar />
    </>
  );
}
