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
import { BOARD_CLOCK_BUDGET_MS } from '@/battle/board/mode';
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
import { PoolRules } from './pool-rules';
import { AmbientClip } from '@/components/ui/ambient-clip';
import './pool-page.css';

/*
 * Founder 2026-09-16 (CHANGE-2026-09-16_ui-uplift.md §A6, then §C the same
 * evening): the page a player decides on wears the pink field, and on a wide
 * screen two rails run down the viewport's edges into the centre where the
 * Enter control is — ONE portrait loop, the right rail its mirror, so the
 * page ships one clip. V3 (founder 2026-09-27): the loop is the "Looping
 * Pool" scene, cut to loop without a seam (a one-second dissolve back to
 * its own start), and the rails take more of the margin. Below lg a single
 * strip carries the same clip above the card. Every number stays on plum;
 * the prize amount stays the only yellow inside a card.
 */
const RAIL = [{ mp4: '/motion/pool/rail.mp4', webm: '/motion/pool/rail.webm' }];
const RAIL_POSTER = '/motion/pool/rail.jpg';

const MIN_SEATS_N = Number(MIN_SEATS);
const FILL_HOURS = Number(DEFAULT_FILL_DEADLINE_SECS / 3600n);
const REVIEW_HOURS = Number(REVIEW_WINDOW_SECS / 3600n);
const BOARD_MINUTES = BOARD_CLOCK_BUDGET_MS / 60_000;

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
  // Phase B: the rule this pool plays, from its record — the badge and the
  // "How this pool plays" box both read it, and the play page's board too.
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
      <div className="pool-field flex w-full">
        <aside className="pool-rail pool-rail-left" aria-hidden="true">
          <AmbientClip tiers={RAIL} poster={RAIL_POSTER} className="pool-rail-clip" />
          <div className="pool-rail-fade" />
        </aside>
      <main id="main" className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24 sm:px-6">
        <div className="pool-strip lg:hidden" aria-hidden="true">
          <AmbientClip tiers={RAIL} poster={RAIL_POSTER} className="pool-strip-clip" playWhenVisible={0.5} />
        </div>
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
              once the pool has sealed; until then the page's own copy says
              what becomes verifiable and when. */}
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
              numbers, larger, and nothing else. The R7-b line saying what the
              deadline would do right now (founder instruction 2026-09-12
              §4.4) came off at the founder's request; the rule it restated is
              the last two points in the box below. PHASE-N-REVIEW. */}
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

        <PoolRules mode={mode} minutes={BOARD_MINUTES} minSeats={MIN_SEATS_N} fillHours={FILL_HOURS} />

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
