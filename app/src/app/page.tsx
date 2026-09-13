/*
 * The landing — the Blot world's front door (master prompt D, v4).
 * Brand layer: hot-pink page, yellow inflated headline, the kettle clip,
 * the live dial demo, cream rail cards. Game layer: the open-pool card
 * and the fixtures ladder are plum, and every number on this page lives
 * on plum — except the 18+/territory line, which the two-layer rule
 * explicitly words rather than numbers.
 *
 * Server component; live data via the indexer seam exactly as before —
 * this is a surface change only. A dead indexer degrades the pool card,
 * never the page.
 *
 * PHASE-4-REVIEW: AppHeader and TabBar still wear the arena skin here;
 * their re-token is PR 8 of the sequence, shared with every other route.
 */
import Link from 'next/link';
import { MIN_SEATS, TIER_ENTRY_LAMPORTS, TIER_POT_LAMPORTS } from '@blotto/scoring';
import { COPY } from '@/copy';
import { indexerApi, live } from '@/data/api';
import { lamportsToSol } from '@/data/format';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';
import { Countdown } from '@/components/ui/countdown';
import { HeroClip, type ClipTier } from '@/components/landing/HeroClip';

/**
 * The hero reel in three cuts of the same 2160p master (founder
 * 2026-09-09: 4K, super clear). A wide screen streams the 2160p cut, a
 * laptop the 1080p, a phone the 720p — the browser picks the first tier
 * whose media query matches (HeroClip).
 */
const HERO_TIERS: readonly ClipTier[] = [
  { mp4: '/motion/landing/hero_montage_2160.mp4', webm: '/motion/landing/hero_montage_2160.webm', media: '(min-width: 1600px)' },
  { mp4: '/motion/landing/hero_montage_1080.mp4', webm: '/motion/landing/hero_montage_1080.webm', media: '(min-width: 768px)' },
  { mp4: '/motion/landing/hero_montage.mp4', webm: '/motion/landing/hero_montage.webm' },
];

import { LiveDemo } from '@/components/landing/LiveDemo';
import { HowItWorksCarousel } from '@/components/landing/HowItWorksCarousel';
import { PreloaderGate } from '@/components/preloader/PreloaderGate';

/** Seat-fill ring in game colours (the arena ProgressRing is blue). */
function SeatRing({ entrants }: { entrants: number }) {
  const size = 96;
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(1, entrants / 64));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-game-raised)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-game-action)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - filled)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tnum font-display text-[22px] font-bold leading-none text-game-ink">
          {entrants}
        </span>
        <span className="text-[9px] uppercase tracking-wide text-game-ink-muted">of 64</span>
      </div>
    </div>
  );
}

export default async function LandingPage() {
  const api = indexerApi();
  // SSR outage guard: a dead indexer degrades this page, never kills it.
  const [poolsLive, treasuryLive, tiersLive] = await Promise.all([
    live(() => api.listPools()),
    live(() => api.getTreasury()),
    live(() => api.getTiers()),
  ]);
  const pools = poolsLive.ok ? poolsLive.value : [];
  const treasury = treasuryLive.ok ? treasuryLive.value : null;
  // Prompt v2 §B.6: the soonest tier still cooling down, for the "next pool
  // opens in" clock when nothing is open. Server time, never the device's.
  const open = pools.filter((p) => p.state === 'Open').sort((a, b) => a.tier - b.tier);
  const hero = open[0];
  const openByTier = new Map(open.map((p) => [p.tier, p]));
  const tierStatus = new Map(treasury?.tiers.map((t) => [t.tier, t]) ?? []);
  // WHICH TIERS THE FOUNDER HAS OPENED — read, never assumed (founder
  // instruction 2026-09-12 §2.3, §2.4). This page used to carry its own
  // `LAUNCH_TIER = 0` constant, so `set_open_tiers` could enable a tier on
  // chain and nothing here would move. `GET /tiers` resolves it from the
  // live Config account.
  //
  // On an indexer outage the fallback is the ground truth in `/pools` — a
  // tier holding an Open pool is open by construction — rather than another
  // constant, which is the defect being removed.
  const tiersRead = tiersLive.ok ? tiersLive.value : null;
  const enabledByTier = tiersRead
    ? new Map(tiersRead.tiers.map((t) => [t.tier, t.enabled]))
    : new Map(open.map((p) => [p.tier, true]));
  // A tier appears if the founder has opened it, OR if it is still running a
  // pool. The second half matters: `open_tiers` gates `open_pool` and
  // nothing else — `register` never reads it — so closing a tier must not
  // hide a pool that is still taking entries from the players in it.
  const ladder = TIER_ENTRY_LAMPORTS.map((entry, tier) => ({ entry, tier })).filter(
    ({ tier }) => enabledByTier.get(tier) === true || openByTier.has(tier)
  );

  return (
    <>
      {/* First-visit curtain — root route only (the gate reads its flag
          client-side); deep links never mount it. */}
      <PreloaderGate />
      <AppHeader />
      <div className="bg-brand-pink">
        {/* ——— Hero (founder 2026-09-09): the montage covers the whole hero and
            the words sit stacked, left-aligned, on a plum scrim. Ten
            existing landscape loops from the same series as the old kettle
            clip, cut into one 51 s crossfaded reel; poster-first, muted,
            looping, and a still under reduced motion (HeroClip). The section
            is full-bleed; everything below stays in the 5xl column. */}
        <section className="relative isolate overflow-hidden bg-brand-berry">
          <HeroClip
            tiers={HERO_TIERS}
            poster="/motion/landing/hero_montage_poster.jpg"
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* Legibility scrim: heavy at the text edge, clear on the right so the
              reel reads; a soft fade into the page pink along the bottom. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[linear-gradient(90deg,rgba(94,27,64,0.92)_0%,rgba(94,27,64,0.74)_40%,rgba(94,27,64,0.22)_72%,rgba(94,27,64,0.05)_100%)] lg:bg-[linear-gradient(90deg,rgba(94,27,64,0.9)_0%,rgba(94,27,64,0.62)_34%,rgba(94,27,64,0.08)_60%,rgba(94,27,64,0)_100%)]"
          />
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-24 bg-[linear-gradient(180deg,transparent_0%,var(--color-brand-pink)_100%)]"
          />
          <div className="relative mx-auto flex w-full max-w-5xl flex-col justify-end px-4 pt-28 pb-10 sm:px-6 sm:pt-36 lg:min-h-[720px] lg:pt-44 lg:pb-16">
            <h1 className="focus:outline-none max-w-[9ch] font-display text-[64px] font-extrabold uppercase leading-[0.92] tracking-tight text-brand-yellow [text-shadow:0_5px_0_rgba(42,16,48,0.35)] sm:text-[96px] lg:text-[116px]">
              {COPY.landing.heroTitle}
            </h1>
            <p className="mt-4 font-display text-[22px] font-bold leading-7 text-brand-cream sm:text-[26px] sm:leading-8">
              {/* Founder 2026-09-09: one sentence per line. The string stays
                  whole in COPY (the shell and the e2e text match use it);
                  only the line breaks are decided here. */}
              {COPY.shell.tagline.split(/(?<=\.)\s+/).map((line) => (
                <span key={line} className="block">
                  {line}{' '}
                </span>
              ))}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              {hero && (
                <Link
                  href={`/pools/${hero.pool}`}
                  className="rounded-full bg-brand-yellow px-8 py-3.5 font-display text-[18px] font-bold uppercase tracking-wide text-game-base shadow-[0_6px_20px_rgba(42,16,48,0.35)] hover:bg-brand-cream"
                >
                  {COPY.pool.enter}
                </Link>
              )}
              <a
                href="#demo"
                className="rounded-full border-2 border-brand-cream px-6 py-3 font-mono text-[13px] uppercase tracking-wide text-brand-cream hover:bg-brand-cream/10"
              >
                {COPY.landing.tryDials}
              </a>
            </div>
            {/* v3 D2: visible without scrolling on mobile (the hero is content-height there). */}
            <p className="mt-5 text-[12px] tracking-[0.02em] text-brand-cream/90">
              {COPY.pool.ageTerritoryNote}
              {' · '}
              <Link href="/rules" className="underline underline-offset-2">
                {COPY.rules.title}
              </Link>
            </p>
          </div>
        </section>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 sm:px-6">

          {/* ——— The open pool: plum card, every number on the game layer. */}
          <section className="mt-10">
            {!poolsLive.ok ? (
              <div className="rounded-2xl bg-game-base p-6">
                <p className="text-[16px] font-medium text-game-ink">{COPY.shell.liveDataUnavailable}</p>
                <p className="mt-1 max-w-prose text-[13px] leading-5 text-game-ink-muted">
                  {COPY.shell.liveDataUnavailableDetail}
                </p>
              </div>
            ) : hero ? (
              <div className="rounded-2xl bg-game-base p-5 sm:p-6">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-game-ink-muted">
                  {COPY.landing.openPoolTitle}
                </p>
                {/* D-E1 §1.4: the pot travels with the pool, not the table. */}
                {BigInt(hero.pot_lamports) !== TIER_POT_LAMPORTS[hero.tier] && (
                  <p className="mt-2 text-[12px] leading-5 text-game-ink-muted">
                    {COPY.pool.potFixedAtOpen}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-6">
                  <SeatRing entrants={hero.entrants} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] uppercase tracking-[0.14em] text-game-ink-muted">
                      {COPY.pool.prizeLabel}
                    </p>
                    <p className="tnum font-display text-[44px] font-extrabold leading-[48px] text-game-prize">
                      {lamportsToSol(hero.pot_lamports)}
                      <span className="ml-2 font-body text-[15px] font-medium text-game-ink-muted">SOL</span>
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-game-ink">
                      <span className="tnum font-display text-[18px] font-bold">
                        {lamportsToSol(hero.entry_lamports)}
                        <span className="ml-1 font-body text-[12px] font-medium text-game-ink-muted">
                          SOL entry
                        </span>
                      </span>
                      {/* PHASE-E1-REVIEW (D18): this clock already sits in the
                          same card as the Enter link, against the rule the
                          Countdown documents. Not moved here — flagged for
                          the founder. It derives from the server's time. */}
                      <Countdown
                        deadlineUnix={hero.fill_deadline}
                        serverTimeUnix={hero.server_time}
                        label={COPY.pool.fillDeadline}
                      />
                    </div>
                  </div>
                </div>
                {/* §8.6: above the enter control, always. */}
                <p className="mt-5 max-w-prose text-[12px] leading-5 text-game-ink-muted">
                  {COPY.pool.decisionsFinal}
                </p>
                <Link
                  href={`/pools/${hero.pool}`}
                  className="mt-3 flex h-14 items-center justify-center rounded-full bg-game-action font-display text-[18px] font-bold uppercase tracking-wide text-game-base hover:brightness-105"
                >
                  {COPY.pool.enter}
                </Link>
                <p className="mt-3 text-center text-[11px] text-game-ink-muted">
                  {COPY.pool.ageTerritoryNote}
                </p>
              </div>
            ) : null /* PHASE-N-REVIEW: the "no tournament is open" card was removed
                        at the founder's direction (2026-09-09). In that state the
                        page shows the hero, the demo, the steps and the ladder;
                        the ladder carries the per-tier status. */}
          </section>

          {/* ——— The live demo: the toy is the pitch. */}
          <section id="demo" className="mt-12 scroll-mt-20">
            <h2 className="mb-4 max-w-[26ch] font-display text-[28px] font-extrabold leading-8 text-brand-berry sm:text-[34px] sm:leading-10">
              {COPY.howItWorks.pentagonCaption}
            </h2>
            <LiveDemo />
          </section>

          {/* ——— How it works: the five ratified steps, one animated scene at a time. */}
          <section className="mt-12">
            <h2 className="mb-4 font-display text-[28px] font-extrabold leading-8 text-brand-berry">
              {COPY.howItWorks.title}
            </h2>
            <HowItWorksCarousel steps={COPY.howItWorks.steps} />
            <p className="mt-4 flex gap-5 text-[13px] text-brand-berry">
              <Link href="/rules" className="underline underline-offset-2">
                {COPY.howItWorks.rulesLink}
              </Link>
              <Link href="/verify" className="underline underline-offset-2">
                {COPY.howItWorks.verifyLink}
              </Link>
              <Link href="/fair-play" className="underline underline-offset-2">
                {COPY.howItWorks.fairPlayLink}
              </Link>
            </p>
          </section>

          {/* ——— The fixtures ladder: every tier, open or covered-or-short. */}
          <section className="mt-12">
            <h2 className="mb-3 font-display text-[28px] font-extrabold leading-8 text-brand-berry">
              {COPY.fixtures.title}
            </h2>
            <ul className="overflow-hidden rounded-2xl bg-game-base">
              {ladder.map(({ entry, tier }) => {
                const openPool = openByTier.get(tier);
                const status = tierStatus.get(tier);
                // A closed tier is not listed at all (founder instruction
                // 2026-09-12 §2.4) — the "Coming soon" row this page used to
                // show for tiers 1-6 is gone, because the approved copy
                // carries no such wording and an unopenable tier advertising
                // a prize pool is a statement about availability we are not
                // in a position to make. `ladder` has already filtered.
                const label = openPool
                  ? COPY.fixtures.statusOpen
                  : status?.status === 'settling'
                    ? COPY.fixtures.statusSettling
                    : status?.status === 'openable'
                      ? COPY.fixtures.statusOpenable
                      : COPY.fixtures.statusShort;
                const shortBy =
                  !openPool && status?.status === 'short' && BigInt(status.short_by_lamports) > 0n
                    ? COPY.fixtures.shortBy(lamportsToSol(status.short_by_lamports))
                    : null;
                const row = (
                  <div
                    className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-game-raised px-4 py-3.5 sm:px-5 ${
                      openPool ? 'bg-game-raised/40' : ''
                    }`}
                  >
                    <span className="tnum w-24 font-display text-[17px] font-bold text-game-ink">
                      {lamportsToSol(entry.toString())}
                      <span className="ml-1 font-body text-[11px] font-medium text-game-ink-muted">SOL</span>
                    </span>
                    <span className="tnum font-display text-[15px] font-semibold text-game-prize">
                      {lamportsToSol(TIER_POT_LAMPORTS[tier].toString())}
                      <span className="ml-1 font-body text-[11px] font-medium text-game-ink-muted">
                        SOL prize pool
                      </span>
                    </span>
                    <span
                      className={`ml-auto text-right text-[12px] ${
                        openPool ? 'text-game-action' : 'text-game-ink-muted'
                      }`}
                    >
                      {openPool
                        ? `${label} · ${COPY.pool.entrantsOf(openPool.entrants, Number(MIN_SEATS))}`
                        : label}
                      {shortBy ? <span className="tnum block text-[11px]">{shortBy}</span> : null}
                    </span>
                  </div>
                );
                return (
                  <li key={tier}>
                    {openPool ? <Link href={`/pools/${openPool.pool}`}>{row}</Link> : row}
                  </li>
                );
              })}
            </ul>
          </section>

          {/* ——— Footer line. */}
          <p className="mt-10 text-center text-[12px] text-brand-berry">
            {COPY.pool.ageTerritoryNote}
          </p>
        </main>
      </div>
      <TabBar />
    </>
  );
}
