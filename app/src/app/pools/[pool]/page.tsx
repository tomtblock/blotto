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
import {
  DEFAULT_FILL_DEADLINE_SECS,
  MIN_SEATS,
  REVIEW_WINDOW_SECS,
  TIER_POT_LAMPORTS,
} from '@blotto/scoring';
import { COPY } from '@/copy';
import { indexerApi, live } from '@/data/api';
import { lamportsToSol } from '@/data/format';
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
import { NeonSection } from '@/components/ui/neon-section';
import { AmbientClip } from '@/components/ui/ambient-clip';
import './pool-page.css';

/*
 * Founder 2026-09-16 (CHANGE-2026-09-16_ui-uplift.md §A6): the page a player
 * decides on wears the yellow field (D2), and on a wide screen two conveyor
 * rails run down either side into the centre where the Enter control is —
 * ONE portrait loop, the right rail its mirror, so the page ships one clip.
 * Below lg a single strip carries the same scene above the card. Every
 * number stays on plum; the prize amount stays the only yellow inside a card.
 */
const RAIL = [{ mp4: '/motion/pool/rail.mp4', webm: '/motion/pool/rail.webm' }];
const RAIL_POSTER = '/motion/pool/rail.jpg';
const STRIP = [{ mp4: '/motion/pool/strip.mp4', webm: '/motion/pool/strip.webm' }];
const STRIP_POSTER = '/motion/pool/strip.jpg';

const MIN_SEATS_N = Number(MIN_SEATS);
const FILL_HOURS = Number(DEFAULT_FILL_DEADLINE_SECS / 3600n);
const REVIEW_HOURS = Number(REVIEW_WINDOW_SECS / 3600n);

export default async function PoolPage({ params }: { params: Promise<{ pool: string }> }) {
  const { pool: poolId } = await params;
  // SSR outage guard: unreachable indexer ≠ nonexistent pool.
  const poolLive = await live(() => indexerApi().getPool(poolId));
  if (!poolLive.ok) {
    return (
      <>
        <AppHeader />
        <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-24">
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
      <div className="flex-1 bg-brand-yellow">
      <div className="pool-field mx-auto flex w-full max-w-[1440px]">
        <aside className="pool-rail pool-rail-left" aria-hidden="true">
          <AmbientClip tiers={RAIL} poster={RAIL_POSTER} className="pool-rail-clip" />
          <div className="pool-rail-fade" />
        </aside>
      <main id="main" className="mx-auto w-full max-w-2xl px-4 pt-6 pb-24">
        <div className="pool-strip lg:hidden" aria-hidden="true">
          <AmbientClip tiers={STRIP} poster={STRIP_POSTER} className="pool-strip-clip" playWhenVisible={0.5} />
        </div>
        <div className="mb-2">
          <BackLink href="/pools" tone="berry">
            {COPY.shell.nav.backToPools}
          </BackLink>
        </div>
        <header className="mb-5 flex flex-wrap items-center gap-3">
          <MarqueeHeading as="h1">{COPY.reveal.passPool(pool.id)}</MarqueeHeading>
          <Pill tone={pool.resolving ? 'resolving' : open ? 'open' : 'muted'}>{poolStateLabel(pool)}</Pill>
          {/* Founder 2026-09-16 (D5): the Verify page recomputes a RESULT from
              the published bundle and the on-chain record, and an open pool
              has neither yet — the link led to "nothing to check". It appears
              once the pool has sealed; until then the page's own copy says
              what becomes verifiable and when. */}
          {!open && (
            <Link
              href={`/verify?pool=${pool.pool}`}
              className="ml-auto rounded-full text-[13px] text-brand-berry underline underline-offset-2 hover:text-brand-deep-magenta"
            >
              {COPY.pool.verifyThisPool}
            </Link>
          )}
        </header>

        {pool.resolving && pool.resolving_until !== null && (
          <Card className="mb-5 flex flex-col gap-2 p-5">
            {/* Stage C: the published resolving window, counted down from the
                server's clock like every other timer, with the rule beside it.
                The window's start is the indexer's sight of PrizesPaid; the
                daemon acts on the on-chain escrow timestamp (Stage D). */}
            <Countdown
              deadlineUnix={pool.resolving_until}
              serverTimeUnix={pool.server_time}
              label={COPY.pool.resolvingEndsIn}
            />
            <p className="max-w-prose text-[13px] leading-5 text-ink-muted">
              {COPY.pool.resolvingNote(REVIEW_HOURS)}
            </p>
          </Card>
        )}

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
                <Stat label={COPY.pool.entryLabel} value={lamportsToSol(pool.entry_lamports)} unit="SOL" />
                {open && (
                  <Countdown
                    deadlineUnix={pool.fill_deadline}
                    serverTimeUnix={pool.server_time}
                    label={COPY.pool.fillDeadline}
                  />
                )}
              </div>
              {/* R7-b §4.4: the countdown and the seat count are both above;
                  this says what they MEAN together, so a player deciding
                  whether to enter does not have to know the rule and do the
                  comparison. Only while entries are open — once a pool has
                  sealed or refunded the question is settled. */}
              {open && (
                <p
                  className={`text-[13px] leading-5 ${
                    pool.outcome_if_deadline_now === 'seal' ? 'text-ink-muted' : 'text-brand'
                  }`}
                >
                  {COPY.pool.outcomeIfDeadlineNow(
                    pool.outcome_if_deadline_now,
                    pool.min_seats
                  )}
                </p>
              )}
            </div>
          </div>
        </Card>

        <NeonSection heading={COPY.pool.aboutHeading} className="mb-8">
          <div className="flex flex-col gap-2 text-[13px] leading-5 text-ink-muted">
            <p>{COPY.pool.prizeRule}</p>
            <p>{COPY.pool.sealed}</p>
            <p>{COPY.pool.refundRule(MIN_SEATS_N, FILL_HOURS)}</p>
            <p className="flex gap-4">
              <Link href="/rules" className="underline underline-offset-2 hover:text-ink">
                {COPY.rules.title}
              </Link>
              <Link href="/fair-play" className="underline underline-offset-2 hover:text-ink">
                {COPY.fairPlay.title}
              </Link>
            </p>
          </div>
        </NeonSection>

        {open ? (
          <section className="flex flex-col gap-3">
            {/* PID §8.6: above the Enter control. Do not move it below. */}
            <p className="text-[14px] font-medium leading-5 text-brand-berry">
              {COPY.pool.decisionsFinal}
            </p>
            <Link
              href={`/play?pool=${pool.pool}`}
              className="key-action flex h-14 items-center justify-center rounded-full bg-brand font-display text-[18px] font-bold uppercase tracking-wide text-(--color-base) transition-colors hover:bg-brand-hot"
            >
              {COPY.pool.enter}
            </Link>
          </section>
        ) : (
          <Link
            href={`/pools/${pool.pool}/results`}
            className="flex h-12 items-center justify-center rounded-full border border-brand-berry/40 text-[15px] font-medium text-brand-berry transition-colors hover:border-brand-berry hover:bg-brand-berry/10"
          >
            {COPY.pool.resultsLink}
          </Link>
        )}
      </main>
        <aside className="pool-rail pool-rail-right" aria-hidden="true">
          <AmbientClip tiers={RAIL} poster={RAIL_POSTER} className="pool-rail-clip" mirror />
          <div className="pool-rail-fade" />
        </aside>
      </div>
      </div>
      <SiteFooter />
      <TabBar />
    </>
  );
}
