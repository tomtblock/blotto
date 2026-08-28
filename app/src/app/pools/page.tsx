/* Pools tab (restyled by v3 D2; per-tier lobby 2026-08-28 — the old
 * handover's §5A remainder): pools grouped by tier, each tier card carrying
 * its entry price, fixed prize pool and 1st-place share from the SAME
 * shared constants the prize path uses (never hand-typed), with the full
 * per-tier prize tables one link away on the rules tab. Within a tier,
 * newest first; open pools wear the brand hairline. */
import Link from 'next/link';
import { TIER_ENTRY_LAMPORTS, TIER_POT_LAMPORTS, amountForRank } from '@blotto/scoring';
import { indexerApi, live } from '@/data/api';
import { lamportsToSol } from '@/data/format';
import { COPY } from '@/copy';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';
import { Card } from '@/components/ui/card';
import { LiveDataUnavailable } from '@/components/shell/live-unavailable';

export default async function PoolsPage() {
  // SSR outage guard: a dead indexer degrades this page, never kills it.
  const poolsLive = await live(() => indexerApi().listPools());
  const pools = poolsLive.ok ? poolsLive.value : [];

  // Group by tier, tiers ascending; a tier appears only when it has pools.
  const byTier = new Map<number, typeof pools>();
  for (const p of pools) {
    const group = byTier.get(p.tier);
    if (group) group.push(p);
    else byTier.set(p.tier, [p]);
  }
  const tiers = [...byTier.keys()].sort((a, b) => a - b);

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-24">
        <div className="mb-5 flex items-baseline justify-between">
          <h1 className="font-display text-[34px] leading-[38px] font-extrabold text-ink">
            Pools
          </h1>
          <Link
            href="/rules"
            className="text-[13px] text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            {COPY.pool.tierTableLink}
          </Link>
        </div>
        {!poolsLive.ok ? (
          <LiveDataUnavailable />
        ) : pools.length === 0 ? (
          <Card className="flex flex-col gap-2 p-6">
            <p className="text-[17px] font-medium text-ink">{COPY.pool.noOpenPool}</p>
            <p className="max-w-prose text-[13px] leading-5 text-ink-muted">
              {COPY.pool.noOpenPoolDetail}
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-8">
            {tiers.map((tier) => {
              const pot = TIER_POT_LAMPORTS[tier];
              return (
                <section key={tier}>
                  <header className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <h2 className="tnum font-display text-[20px] font-bold text-ink">
                      {COPY.pool.tierEntry(lamportsToSol(TIER_ENTRY_LAMPORTS[tier].toString()))}
                    </h2>
                    <span className="tnum text-[13px] font-semibold text-prize">
                      {COPY.pool.tierPot(lamportsToSol(pot.toString()))}
                    </span>
                    <span className="tnum text-[13px] text-ink-muted">
                      {COPY.pool.tierFirst(lamportsToSol(amountForRank(pot, 1).toString()))}
                    </span>
                  </header>
                  <ul className="flex flex-col gap-3">
                    {byTier.get(tier)!.map((p) => (
                      <li key={p.pool}>
                        <Link href={`/pools/${p.pool}`}>
                          <Card
                            className={
                              'flex items-center gap-4 px-4 py-3 transition-colors hover:border-brand/40 ' +
                              (p.state === 'Open' ? 'border-brand/40' : '')
                            }
                          >
                            <span className="tnum font-mono text-[12px] text-ink-muted">
                              #{p.id}
                            </span>
                            <span className="text-[13px] text-ink-muted">
                              {COPY.pool.entrantsOf(p.entrants)}
                            </span>
                            <span className="ml-auto rounded-full border border-line px-2.5 py-0.5 text-[11px] uppercase tracking-[0.1em] text-ink-muted">
                              {p.state}
                            </span>
                          </Card>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </main>
      <TabBar />
    </>
  );
}
