/*
 * Play tab (roadmap 3.1/3.2; restyled by v3 D2): the arena's front page.
 * The open pool is the LIVE fixture card — fixed prize pool big in prize
 * amber, the seat ring filling, the fill-deadline clock calm — and tiers the
 * treasury has not yet covered render locked, stating the rule that opens
 * them. The 18+/territory line sits directly under the hero so it is visible
 * without scrolling on a phone (v3 D2 requirement).
 *
 * Server component; live data via the indexer seam. Tier constants come from
 * the same shared module the prize path uses — never hand-typed.
 */
import Link from 'next/link';
import { TIER_ENTRY_LAMPORTS, TIER_POT_LAMPORTS } from '@blotto/scoring';
import { COPY } from '@/copy';
import { indexerApi } from '@/data/api';
import { lamportsToSol } from '@/data/format';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';
import { Card } from '@/components/ui/card';
import { Stat } from '@/components/ui/stat';
import { Countdown } from '@/components/ui/countdown';
import { ProgressRing } from '@/components/ui/progress-ring';

export default async function PlayPage() {
  const pools = await indexerApi().listPools();
  const open = pools
    .filter((p) => p.state === 'Open')
    .sort((a, b) => a.tier - b.tier);
  const hero = open[0];
  const others = open.slice(1);
  const openTiers = new Set(open.map((p) => p.tier));
  const lockedTiers = TIER_ENTRY_LAMPORTS.map((_, tier) => tier).filter(
    (tier) => !openTiers.has(tier)
  );

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-24">
        <h1 className="mb-5 max-w-[22ch] font-display text-[34px] leading-[38px] font-extrabold text-ink sm:text-[56px] sm:leading-[58px]">
          {COPY.shell.tagline}
        </h1>

        {hero ? (
          <Card live className="p-5">
            <div className="flex items-center gap-5">
              <ProgressRing
                value={hero.entrants}
                total={64}
                size={104}
                label={`${hero.entrants} of 64 seats filled`}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <Stat
                  label={COPY.pool.prizeTableTitle}
                  value={lamportsToSol(hero.pot_lamports)}
                  unit="SOL"
                  tone="prize"
                />
                <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                  <Stat
                    label="Entry"
                    value={lamportsToSol(hero.entry_lamports)}
                    unit="SOL"
                  />
                  <Countdown deadlineUnix={hero.fill_deadline} label={COPY.pool.fillDeadline} />
                </div>
              </div>
            </div>
            <Link
              href={`/pools/${hero.pool}`}
              className="mt-5 flex h-14 items-center justify-center rounded-xl bg-brand text-[17px] font-semibold text-(--color-base) transition-colors hover:bg-brand-hot"
            >
              {COPY.pool.enter}
            </Link>
          </Card>
        ) : (
          <Card className="flex flex-col items-start gap-2 p-6">
            <p className="text-[17px] font-medium text-ink">{COPY.pool.noOpenPool}</p>
            <p className="max-w-prose text-[13px] leading-5 text-ink-muted">
              {COPY.pool.noOpenPoolDetail}
            </p>
          </Card>
        )}

        {/* v3 D2: visible without scrolling on mobile — directly under the hero. */}
        <p className="mt-3 text-center text-[12px] tracking-[0.02em] text-ink-muted">
          {COPY.pool.ageTerritoryNote}
          {' · '}
          <Link href="/rules" className="underline underline-offset-2 hover:text-ink">
            {COPY.rules.title}
          </Link>
        </p>

        {others.length > 0 && (
          <ul className="mt-8 flex flex-col gap-3">
            {others.map((p) => (
              <li key={p.pool}>
                <Link href={`/pools/${p.pool}`}>
                  <Card className="flex items-center gap-4 px-4 py-3 transition-colors hover:border-brand/40">
                    <span className="tnum font-display text-[18px] font-bold text-ink">
                      {lamportsToSol(p.entry_lamports)}
                      <span className="ml-1 font-body text-[11px] font-medium text-ink-muted">
                        SOL
                      </span>
                    </span>
                    <span className="text-[13px] text-ink-muted">
                      {COPY.pool.entrantsOf(p.entrants)}
                    </span>
                    <span className="tnum ml-auto font-display text-[15px] font-semibold text-prize">
                      {lamportsToSol(p.pot_lamports)}
                      <span className="ml-1 font-body text-[11px] font-medium text-ink-muted">
                        SOL
                      </span>
                    </span>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {lockedTiers.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-[12px] uppercase tracking-[0.14em] text-ink-muted">
              Locked tiers
            </h2>
            <ul className="flex flex-col gap-2">
              {lockedTiers.map((tier) => (
                <li
                  key={tier}
                  className="flex items-center gap-4 rounded-xl border border-line/60 px-4 py-3"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4 text-ink-muted" aria-hidden>
                    <path
                      d="M7 10V8a5 5 0 0 1 10 0v2m-9 0h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className="tnum font-display text-[15px] font-semibold text-ink-muted">
                    {lamportsToSol(TIER_ENTRY_LAMPORTS[tier].toString())}
                    <span className="ml-1 font-body text-[11px] font-medium">SOL</span>
                  </span>
                  <span className="tnum text-[13px] text-ink-muted">
                    {lamportsToSol(TIER_POT_LAMPORTS[tier].toString())} SOL prize pool
                  </span>
                  <span className="ml-auto text-right text-[12px] text-ink-muted">
                    {COPY.pool.lockedTier}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <TabBar />
    </>
  );
}
