/*
 * The pool page (roadmap 3.2; restyled by v3 D2; D-E2/D-E4 2026-09-06,
 * option A 2026-09-07): the fixture in full — the seat ring, the fixed
 * prize pool and the one-line rule for who receives it, the ONE clock (the
 * fill deadline set at open, 12 h at launch, derived from the server's
 * time) — and the §8.6 "decisions are final" statement ABOVE the enter
 * control, which is a legal-position requirement, not layout taste.
 *
 * Founder 2026-09-30: this page is no longer a stop on the way in. The home
 * card's Enter lands on the board, and "How this pool…" moved there beside
 * it (app/play/entry-rail.tsx); the rails clip that framed this page went
 * with it. What remains is the pool's RECORD — the numbers, the resolving
 * window, the results and verify links — reached from the profile, the
 * notifications, a shared link and the results page's back link, and its
 * own Enter goes straight to the board like the home card's.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { REVIEW_WINDOW_SECS, TIER_POT_LAMPORTS } from '@blotto/scoring';
import { COPY } from '@/copy';
import { indexerApi, live } from '@/data/api';
import { lamportsToSol, poolMode } from '@/data/format';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';
import { LiveDataUnavailable } from '@/components/shell/live-unavailable';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { BackLink } from '@/components/ui/back-link';
import { SiteFooter } from '@/components/shell/site-footer';
import { Stat } from '@/components/ui/stat';
import { ProgressRing } from '@/components/ui/progress-ring';
import { Countdown } from '@/components/ui/countdown';
import { poolStateLabel } from '@/components/pools/pool-state-label';
import { MarqueeHeading } from '@/components/ui/marquee-heading';

const REVIEW_HOURS = Number(REVIEW_WINDOW_SECS / 3600n);

export default async function PoolPage({ params }: { params: Promise<{ pool: string }> }) {
  const { pool: poolId } = await params;
  // SSR outage guard: unreachable indexer ≠ nonexistent pool.
  const poolLive = await live(() => indexerApi().getPool(poolId));
  if (!poolLive.ok) {
    return (
      <>
        <AppHeader />
        <div className="flex-1 bg-brand-pink">
          <main id="main" className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24">
            <LiveDataUnavailable />
          </main>
        </div>
        <TabBar />
      </>
    );
  }
  const pool = poolLive.value;
  if (!pool) notFound();
  const open = pool.state === 'Open';
  // Phase B: the rule this pool plays, from its record — the badge reads
  // it, and the play page's board too.
  const mode = poolMode(pool);
  // D-E1 §1.4: a pool carries the pot it OPENED with; when the launch
  // table has since moved, say the guarantee rather than look like a cut.
  const potDiffers =
    pool.tier >= 0 &&
    pool.tier < TIER_POT_LAMPORTS.length &&
    BigInt(pool.pot_lamports) !== TIER_POT_LAMPORTS[pool.tier];

  return (
    <>
      <AppHeader />
      <div className="flex-1 bg-brand-pink">
        <main id="main" className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24 sm:px-6">
          <div className="mb-2">
            <BackLink href="/pools" tone="berry">
              {COPY.shell.nav.backToPools}
            </BackLink>
          </div>
          <header className="mb-6 flex flex-wrap items-center gap-3">
            <MarqueeHeading as="h1">{COPY.reveal.passPool(pool.id)}</MarqueeHeading>
            <Pill tone="field">{poolStateLabel(pool)}</Pill>
            {/* The mode this pool plays (founder 2026-09-24), from the pool
                record (Phase B). */}
            <Pill tone="ink" data-testid="pool-mode">
              {mode === 'hard' ? COPY.board.modeHard : COPY.board.modeEasy}
            </Pill>
            {/* Founder 2026-09-16 (D5): the Verify page recomputes a RESULT from
                the published bundle and the on-chain record, and an open pool
                has neither yet — the link led to "nothing to check". It appears
                once the pool has sealed. */}
            {!open && (
              <Link
                href={`/verify?pool=${pool.pool}`}
                className="ml-auto rounded-full text-[14px] text-brand-berry underline underline-offset-2 hover:text-brand-deep-magenta"
              >
                {COPY.pool.verifyThisPool}
              </Link>
            )}
          </header>

          {pool.resolving && pool.resolving_until !== null && (
            <Card className="mb-6 flex flex-col gap-3 p-6 sm:p-8">
              {/* Stage C: the published resolving window, counted down from the
                  server's clock like every other timer, with the rule beside it.
                  The window's start is the indexer's sight of PrizesPaid; the
                  daemon acts on the on-chain escrow timestamp (Stage D). */}
              <Countdown
                size="lg"
                deadlineUnix={pool.resolving_until}
                serverTimeUnix={pool.server_time}
                label={COPY.pool.resolvingEndsIn}
              />
              <p className="max-w-prose text-[15px] leading-6 text-ink-muted">
                {COPY.pool.resolvingNote(REVIEW_HOURS)}
              </p>
            </Card>
          )}

          <Card live={open} className="mb-6 p-6 sm:p-8">
            {potDiffers && (
              <p className="mb-4 text-[15px] leading-6 text-ink-muted">
                {COPY.pool.potFixedAtOpen}
              </p>
            )}
            {/* Founder 2026-09-16 (round two): the card carries the fixture's
                numbers, larger, and nothing else. The rule for who is paid and
                the fill rule are on the board's rail, where the player enters. */}
            <div className="flex flex-wrap items-center gap-6 sm:gap-8">
              <ProgressRing
                value={pool.entrants}
                total={64}
                size={140}
                label={`${pool.entrants} of 64 seats filled`}
              >
                <span className="tnum font-display text-[28px] font-bold leading-none text-ink">
                  {pool.entrants}
                  <span className="text-[18px] text-ink-muted">/64</span>
                </span>
              </ProgressRing>
              <div className="flex min-w-0 flex-1 flex-col gap-5">
                <Stat
                  size="lg"
                  label={COPY.pool.prizeLabel}
                  value={lamportsToSol(pool.pot_lamports)}
                  unit="SOL"
                  tone="prize"
                />
                <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
                  <Stat size="lg" label={COPY.pool.entryLabel} value={lamportsToSol(pool.entry_lamports)} unit="SOL" />
                  {open && (
                    <Countdown
                      size="lg"
                      deadlineUnix={pool.fill_deadline}
                      serverTimeUnix={pool.server_time}
                      label={COPY.pool.fillDeadline}
                    />
                  )}
                </div>
              </div>
            </div>
          </Card>

          {open ? (
            <section className="flex flex-col gap-4">
              {/* PID §8.6: above the Enter control. Do not move it below. */}
              <p className="text-[16px] font-semibold leading-6 text-brand-berry">
                {COPY.pool.decisionsFinal}
              </p>
              {/* On the pink field the commit colour needs the cream ring the
                  welcome curtain's Enter wears, or pink sits on pink. */}
              <Link
                href={`/play?pool=${pool.pool}`}
                className="key-action flex h-16 items-center justify-center rounded-full border-[3px] border-brand-cream bg-brand font-display text-[20px] font-bold uppercase tracking-wide text-(--color-base) transition-colors hover:bg-brand-hot"
              >
                {COPY.pool.enter}
              </Link>
              <p className="flex gap-5 text-[14px] text-brand-berry">
                <Link href="/rules" className="underline underline-offset-2 hover:text-brand-deep-magenta">
                  {COPY.rules.title}
                </Link>
                <Link href="/fair-play" className="underline underline-offset-2 hover:text-brand-deep-magenta">
                  {COPY.fairPlay.title}
                </Link>
              </p>
            </section>
          ) : (
            <Link
              href={`/pools/${pool.pool}/results`}
              className="key-cream flex h-14 items-center justify-center rounded-full font-display text-[18px] font-bold uppercase tracking-wide"
            >
              {COPY.pool.resultsLink}
            </Link>
          )}
        </main>
      </div>
      <SiteFooter />
      <TabBar />
    </>
  );
}
