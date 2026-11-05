/* Pools tab (restyled by v3 D2; per-tier lobby 2026-08-28 — the old
 * handover's §5A remainder): pools grouped by their pool TYPE's price and
 * size (D-E19, the Ladder), each group carrying the entry price and the
 * players on its marquee and the pool's prizes as its first line — read
 * from the pools' own records (`poolLadder`), never from a table here —
 * with every prize table one link away on the rules tab. A size filter
 * ("All · 8 · 16 · 32 · 64") narrows the list. Within a group, the easy
 * board's pools first, then the hard board's.
 *
 * Round four A2 (founder 2026-09-17): the page is on the pink field like
 * every other; each group is a titled neon box, the pool rows plain rows
 * within it, the archive a box of its own. */
import Link from 'next/link';
import { POOL_CAPACITIES } from '@blotto/scoring';
import { indexerApi, live } from '@/data/api';
import { lamportsToSol, poolLadder, poolMode } from '@/data/format';
import type { PoolSummary } from '@/data/types';
import { COPY } from '@/copy';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';
import { PageIntro } from '@/components/ui/page-intro';
import { NeonSection } from '@/components/ui/neon-section';
import { Pill } from '@/components/ui/pill';
import { SiteFooter } from '@/components/shell/site-footer';
import { LiveDataUnavailable } from '@/components/shell/live-unavailable';
import { PoolStateBlot } from '@/components/pools/PoolStateBlot';
import { poolStateLabel } from '@/components/pools/pool-state-label';
import { prizeSummary } from '@/components/pools/prize-table';
import { SizeFilter, type SizeGroup } from '@/components/pools/size-filter';

/** A pool row inside a group box: the state Blot, the number, the field, the state chip. */
const ROW =
  'flex items-center gap-4 rounded-2xl border px-4 py-3 transition-colors hover:bg-white/8 ';

/** A pool's prizes as one comparable key — groups agree on a line only when every pool's does. */
const amountsKey = (p: PoolSummary) => poolLadder(p).prizeAmounts.join(',');

export default async function PoolsPage() {
  // SSR outage guard: a dead indexer degrades this page, never kills it.
  const poolsLive = await live(() => indexerApi().listPools());
  const pools = poolsLive.ok ? poolsLive.value : [];

  // E3: settled (Paid) pools move to the archive box below — the tier
  // boxes stay about pools someone can still watch or join. Closed refund
  // pools keep their row: they have no results to archive. A RESOLVING
  // pool (Stage C: paid, with a share still under review inside the
  // published window) is still one to watch, so it stays in its tier.
  const active = pools.filter((p) => p.state !== 'Paid' || p.resolving);
  const archived = pools.filter((p) => p.state === 'Paid' && !p.resolving);

  // Group by price then size (D-E19), both ascending; a group appears only
  // when it has pools. Within a group the easy board's pools come first,
  // then the hard board's (Phase B) — each pool wears its mode chip so the
  // two never read as one queue.
  const byGroup = new Map<string, { tier: number; capacity: number; pools: PoolSummary[] }>();
  for (const p of active) {
    const capacity = poolLadder(p).capacity;
    const key = `${p.tier}:${capacity}`;
    const group = byGroup.get(key);
    if (group) group.pools.push(p);
    else byGroup.set(key, { tier: p.tier, capacity, pools: [p] });
  }
  const groups = [...byGroup.entries()]
    .map(([key, g]) => ({ key, ...g }))
    .sort((a, b) => a.tier - b.tier || a.capacity - b.capacity);
  for (const g of groups) {
    g.pools.sort((a, b) => (poolMode(a) === poolMode(b) ? 0 : poolMode(a) === 'easy' ? -1 : 1));
  }

  const sizeGroups: SizeGroup[] = groups.map((g) => {
    // The prize line belongs to the group only when every pool in it pays
    // the same table (a settling pool opened before an economics change
    // keeps its own); otherwise each row says its own.
    const shared = g.pools.every((p) => amountsKey(p) === amountsKey(g.pools[0]!));
    return {
      key: g.key,
      capacity: g.capacity,
      node: (
        <NeonSection
          heading={COPY.pool.sizeGroup(lamportsToSol(g.pools[0]!.entry_lamports), g.capacity)}
          data-testid={`pools-group-${g.capacity}`}
        >
          {shared ? (
            <p className="tnum mb-4 font-display text-[20px] font-bold text-prize">
              {prizeSummary(g.capacity, poolLadder(g.pools[0]!).prizeAmounts)}
            </p>
          ) : null}
          <ul className="flex flex-col gap-2">
            {g.pools.map((p) => {
              const ladder = poolLadder(p);
              return (
                <li key={p.pool}>
                  <Link
                    href={`/pools/${p.pool}`}
                    className={
                      ROW +
                      (p.state === 'Open' ? 'border-brand/60 bg-brand/10' : 'border-white/10 bg-white/5')
                    }
                  >
                    {/* The 48px state object (master prompt D): the
                        pool's lifecycle as a Blot shape. */}
                    <PoolStateBlot
                      state={p.state}
                      entrants={p.entrants}
                      minSeats={ladder.minSeats}
                      resolving={p.resolving}
                    />
                    {/* The number and the field stack on a phone, sit in a
                        line from sm — the row never wraps its state chip. */}
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-3">
                      <span className="tnum font-display text-[20px] font-bold text-ink">
                        #{p.id}
                      </span>
                      <span className="text-[14px] text-ink-muted">
                        {COPY.pool.entrantsOf(p.entrants, ladder.capacity, ladder.minSeats)}
                      </span>
                      {/* Phase B: which rule this pool plays. */}
                      <span className="text-[12px] text-ink-muted">
                        {poolMode(p) === 'hard' ? COPY.board.modeHard : COPY.board.modeEasy}
                      </span>
                      {!shared ? (
                        <span className="tnum text-[12px] text-prize">{prizeSummary(ladder.capacity, ladder.prizeAmounts)}</span>
                      ) : null}
                    </span>
                    <Pill
                      tone={p.resolving ? 'resolving' : p.state === 'Open' ? 'open' : 'muted'}
                      className="ml-auto shrink-0"
                    >
                      {poolStateLabel(p)}
                    </Pill>
                  </Link>
                </li>
              );
            })}
          </ul>
        </NeonSection>
      ),
    };
  });

  return (
    <>
      <AppHeader />
      <div className="flex-1 bg-brand-pink">
      <main id="main" className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24">
        <PageIntro
          tone="marquee"
          title={COPY.shell.tabs.pools}
          aside={
            <Link
              href="/rules"
              className="rounded-full text-[14px] text-brand-berry underline underline-offset-2 hover:text-brand-deep-magenta"
            >
              {COPY.pool.tierTableLink}
            </Link>
          }
        />
        <div className="flex flex-col gap-10">
        {!poolsLive.ok ? (
          <LiveDataUnavailable />
        ) : active.length === 0 ? (
          <NeonSection heading={COPY.pool.noOpenPool}>
            <p className="max-w-prose text-[15px] leading-6 text-ink-muted">
              {COPY.pool.noOpenPoolDetail}
            </p>
          </NeonSection>
        ) : (
          <SizeFilter sizes={POOL_CAPACITIES} groups={sizeGroups} />
        )}
        {poolsLive.ok && archived.length > 0 && (
          <NeonSection heading={COPY.pool.archiveTitle}>
            <p className="mb-4 text-[14px] leading-5 text-ink-muted">{COPY.pool.archiveNote}</p>
            <ul className="flex flex-col gap-2">
              {archived.map((p) => (
                <li key={p.pool}>
                  <Link href={`/pools/${p.pool}/results`} className={ROW + 'border-white/10 bg-white/5'}>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                      <span className="tnum font-display text-[18px] font-bold text-ink">#{p.id}</span>
                      <span className="text-[14px] text-ink-muted">
                        {COPY.pool.tierEntry(lamportsToSol(p.entry_lamports))}
                      </span>
                      <span className="tnum text-[14px] font-semibold text-prize">
                        {prizeSummary(poolLadder(p).capacity, poolLadder(p).prizeAmounts)}
                      </span>
                    </span>
                    <Pill className="ml-auto shrink-0">{p.state}</Pill>
                  </Link>
                </li>
              ))}
            </ul>
          </NeonSection>
        )}
        </div>
      </main>
      </div>
      <SiteFooter />
      <TabBar />
    </>
  );
}
