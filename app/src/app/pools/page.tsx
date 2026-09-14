/* Pools tab (restyled by v3 D2; per-tier lobby 2026-08-28 — the old
 * handover's §5A remainder): pools grouped by tier, each tier card carrying
 * its entry price and fixed prize pool from the SAME shared constants the
 * prize path uses (never hand-typed) — the winner takes that pool (D-E2),
 * so there is no second figure — with the per-tier table one link away on
 * the rules tab. Within a tier, newest first; open pools wear the brand
 * hairline. */
import Link from 'next/link';
import { MIN_SEATS, TIER_ENTRY_LAMPORTS, TIER_POT_LAMPORTS } from '@blotto/scoring';
import { indexerApi, live } from '@/data/api';
import { lamportsToSol } from '@/data/format';
import { COPY } from '@/copy';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { SiteFooter } from '@/components/shell/site-footer';
import { LiveDataUnavailable } from '@/components/shell/live-unavailable';
import { PoolStateBlot } from '@/components/pools/PoolStateBlot';
import { poolStateLabel } from '@/components/pools/pool-state-label';

export default async function PoolsPage() {
  // SSR outage guard: a dead indexer degrades this page, never kills it.
  const poolsLive = await live(() => indexerApi().listPools());
  const pools = poolsLive.ok ? poolsLive.value : [];

  // E3: settled (Paid) pools move to the archive strip below — the tier
  // lanes stay about pools someone can still watch or join. Closed refund
  // pools keep their lane row: they have no results to archive. A RESOLVING
  // pool (Stage C: paid, with a share still under review inside the
  // published window) is still one to watch, so it stays in its lane.
  const active = pools.filter((p) => p.state !== 'Paid' || p.resolving);
  const archived = pools.filter((p) => p.state === 'Paid' && !p.resolving);

  // Group by tier, tiers ascending; a tier appears only when it has pools.
  const byTier = new Map<number, typeof pools>();
  for (const p of active) {
    const group = byTier.get(p.tier);
    if (group) group.push(p);
    else byTier.set(p.tier, [p]);
  }
  const tiers = [...byTier.keys()].sort((a, b) => a - b);

  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-24">
        <div className="mb-5 flex items-baseline justify-between">
          <h1 className="font-display text-[34px] leading-[38px] font-extrabold text-ink">
            {COPY.shell.tabs.pools}
          </h1>
          <Link
            href="/rules"
            className="rounded-full text-[13px] text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            {COPY.pool.tierTableLink}
          </Link>
        </div>
        {!poolsLive.ok ? (
          <LiveDataUnavailable />
        ) : active.length === 0 ? (
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
                    <span className="text-[13px] text-ink-muted">{COPY.pool.tierWinner}</span>
                  </header>
                  <ul className="flex flex-col gap-3">
                    {byTier.get(tier)!.map((p) => (
                      <li key={p.pool}>
                        <Link href={`/pools/${p.pool}`} className="block rounded-[24px]">
                          <Card
                            interactive
                            live={p.state === 'Open'}
                            className="flex items-center gap-4 px-4 py-3.5"
                          >
                            {/* The 48px state object (master prompt D): the
                                pool's lifecycle as a Blot shape. No amount
                                shares this row — prize figures stay in the
                                tier header above. */}
                            <PoolStateBlot
                              state={p.state}
                              entrants={p.entrants}
                              resolving={p.resolving}
                            />
                            <span className="tnum font-display text-[18px] font-bold text-ink">
                              #{p.id}
                            </span>
                            <span className="text-[13px] text-ink-muted">
                              {COPY.pool.entrantsOf(p.entrants, Number(MIN_SEATS))}
                            </span>
                            <Pill
                              tone={p.resolving ? 'resolving' : p.state === 'Open' ? 'open' : 'muted'}
                              className="ml-auto"
                            >
                              {poolStateLabel(p)}
                            </Pill>
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
        {poolsLive.ok && archived.length > 0 && (
          <section className="mt-10">
            <header className="mb-3">
              <h2 className="font-display text-[20px] font-bold text-ink">
                {COPY.pool.archiveTitle}
              </h2>
              <p className="text-[13px] leading-5 text-ink-muted">{COPY.pool.archiveNote}</p>
            </header>
            <ul className="flex flex-col gap-2">
              {archived.map((p) => (
                <li key={p.pool}>
                  <Link href={`/pools/${p.pool}/results`} className="block rounded-[24px]">
                    <Card interactive className="flex items-center gap-4 px-4 py-3">
                      <span className="tnum font-display text-[16px] font-bold text-ink">#{p.id}</span>
                      <span className="text-[13px] text-ink-muted">
                        {COPY.pool.tierEntry(lamportsToSol(p.entry_lamports))}
                      </span>
                      <span className="tnum text-[13px] font-semibold text-prize">
                        {COPY.pool.tierPot(lamportsToSol(p.pot_lamports))}
                      </span>
                      <Pill className="ml-auto">{p.state}</Pill>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <SiteFooter />
      <TabBar />
    </>
  );
}
