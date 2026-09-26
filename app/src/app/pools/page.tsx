/* Pools tab (restyled by v3 D2; per-tier lobby 2026-08-28 — the old
 * handover's §5A remainder): pools grouped by tier, each tier box carrying
 * its entry price and fixed prize pool from the SAME shared constants the
 * prize path uses (never hand-typed) — the winner takes that pool (D-E2),
 * so there is no second figure — with the per-tier table one link away on
 * the rules tab. Within a tier, newest first.
 *
 * Round four A2 (founder 2026-09-17): the page is on the pink field like
 * every other; each tier is a titled neon box (its entry price on the
 * marquee, the prize pool as the first line inside), the pool rows plain
 * rows within it, the archive a box of its own. */
import Link from 'next/link';
import { MIN_SEATS, TIER_ENTRY_LAMPORTS, TIER_POT_LAMPORTS } from '@blotto/scoring';
import { indexerApi, live } from '@/data/api';
import { lamportsToSol, poolMode } from '@/data/format';
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

/** A pool row inside a tier box: the state Blot, the number, the field, the state chip. */
const ROW =
  'flex items-center gap-4 rounded-2xl border px-4 py-3 transition-colors hover:bg-white/8 ';

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

  // Group by tier, tiers ascending; a tier appears only when it has pools.
  // Within a tier the easy ladder's pools come first, then the hard
  // ladder's (Phase B) — each pool wears its mode chip so the two never read
  // as one queue.
  const byTier = new Map<number, typeof pools>();
  for (const p of active) {
    const group = byTier.get(p.tier);
    if (group) group.push(p);
    else byTier.set(p.tier, [p]);
  }
  for (const group of byTier.values()) {
    group.sort((a, b) => (poolMode(a) === poolMode(b) ? 0 : poolMode(a) === 'easy' ? -1 : 1));
  }
  const tiers = [...byTier.keys()].sort((a, b) => a - b);

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
          tiers.map((tier) => {
            const pot = TIER_POT_LAMPORTS[tier];
            return (
              <NeonSection
                key={tier}
                heading={COPY.pool.tierEntry(lamportsToSol(TIER_ENTRY_LAMPORTS[tier].toString()))}
              >
                <p className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="tnum font-display text-[22px] font-bold text-prize">
                    {COPY.pool.tierPot(lamportsToSol(pot.toString()))}
                  </span>
                  <span className="text-[14px] text-ink-muted">{COPY.pool.tierWinner}</span>
                </p>
                <ul className="flex flex-col gap-2">
                  {byTier.get(tier)!.map((p) => (
                    <li key={p.pool}>
                      <Link
                        href={`/pools/${p.pool}`}
                        className={
                          ROW +
                          (p.state === 'Open' ? 'border-brand/60 bg-brand/10' : 'border-white/10 bg-white/5')
                        }
                      >
                        {/* The 48px state object (master prompt D): the
                            pool's lifecycle as a Blot shape. No amount
                            shares this row — prize figures stay in the
                            tier's first line above. */}
                        <PoolStateBlot
                          state={p.state}
                          entrants={p.entrants}
                          resolving={p.resolving}
                        />
                        {/* The number and the field stack on a phone, sit in a
                            line from sm — the row never wraps its state chip. */}
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                          <span className="tnum font-display text-[20px] font-bold text-ink">
                            #{p.id}
                          </span>
                          <span className="text-[14px] text-ink-muted">
                            {COPY.pool.entrantsOf(p.entrants, Number(MIN_SEATS))}
                          </span>
                          {/* Phase B: which rule this pool plays. */}
                          <span className="text-[12px] text-ink-muted">
                            {poolMode(p) === 'hard' ? COPY.board.modeHard : COPY.board.modeEasy}
                          </span>
                        </span>
                        <Pill
                          tone={p.resolving ? 'resolving' : p.state === 'Open' ? 'open' : 'muted'}
                          className="ml-auto shrink-0"
                        >
                          {poolStateLabel(p)}
                        </Pill>
                      </Link>
                    </li>
                  ))}
                </ul>
              </NeonSection>
            );
          })
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
                        {COPY.pool.tierPot(lamportsToSol(p.pot_lamports))}
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
