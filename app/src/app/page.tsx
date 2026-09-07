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
import { HeroClip } from '@/components/landing/HeroClip';
import { LiveDemo } from '@/components/landing/LiveDemo';
import { PreloaderGate } from '@/components/preloader/PreloaderGate';

const RAIL_STILLS = [
  '/motion/landing/rail_vending.jpg',
  '/motion/landing/rail_scale.jpg',
  '/motion/landing/rail_blender.jpg',
  '/motion/landing/rail_letterbox.jpg',
  '/motion/landing/rail_mirror.jpg',
];

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
  const [poolsLive, treasuryLive] = await Promise.all([
    live(() => api.listPools()),
    live(() => api.getTreasury()),
  ]);
  const pools = poolsLive.ok ? poolsLive.value : [];
  const treasury = treasuryLive.ok ? treasuryLive.value : null;
  const open = pools.filter((p) => p.state === 'Open').sort((a, b) => a.tier - b.tier);
  const hero = open[0];
  const openByTier = new Map(open.map((p) => [p.tier, p]));
  const tierStatus = new Map(treasury?.tiers.map((t) => [t.tier, t]) ?? []);

  return (
    <>
      {/* First-visit curtain — root route only (the gate reads its flag
          client-side); deep links never mount it. */}
      <PreloaderGate />
      <AppHeader />
      <div className="bg-brand-pink">
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-8 pb-28 sm:px-6">
          {/* ——— Hero: inflated headline + the kettle, side by side on 1440. */}
          <section className="grid items-center gap-6 lg:grid-cols-2 lg:gap-10">
            <div>
              <h1 className="focus:outline-none font-display text-[64px] font-extrabold uppercase leading-[0.92] tracking-tight text-brand-yellow [text-shadow:0_5px_0_rgba(94,27,64,0.22)] sm:text-[96px] lg:text-[116px]">
                {COPY.landing.heroTitle}
              </h1>
              <p className="mt-4 max-w-[30ch] font-display text-[22px] font-bold leading-7 text-brand-berry sm:text-[26px] sm:leading-8">
                {COPY.shell.tagline}
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-4">
                {hero && (
                  <Link
                    href={`/pools/${hero.pool}`}
                    className="rounded-full bg-game-base px-8 py-3.5 font-display text-[18px] font-bold uppercase tracking-wide text-game-ink shadow-[0_6px_20px_rgba(94,27,64,0.35)] hover:bg-game-raised"
                  >
                    {COPY.pool.enter}
                  </Link>
                )}
                <a
                  href="#demo"
                  className="rounded-full border-2 border-brand-berry px-6 py-3 font-mono text-[13px] uppercase tracking-wide text-brand-berry hover:bg-brand-berry/10"
                >
                  {COPY.landing.tryDials}
                </a>
              </div>
              {/* v3 D2: visible without scrolling on mobile. */}
              <p className="mt-4 text-[12px] tracking-[0.02em] text-brand-berry">
                {COPY.pool.ageTerritoryNote}
                {' · '}
                <Link href="/rules" className="underline underline-offset-2">
                  {COPY.rules.title}
                </Link>
              </p>
            </div>
            <HeroClip
              mp4="/motion/landing/hero_kettle.mp4"
              webm="/motion/landing/hero_kettle.webm"
              poster="/motion/landing/hero_kettle_poster.jpg"
              className="w-full rounded-3xl shadow-[0_12px_40px_rgba(94,27,64,0.25)]"
            />
          </section>

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
                          the founder; the go-timer label swap is the only
                          change. */}
                      <Countdown
                        deadlineUnix={hero.fill_deadline}
                        label={hero.go_deadline ? COPY.pool.goTimer : COPY.pool.fillDeadline}
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
            ) : (
              <div className="rounded-2xl bg-game-base p-6">
                <p className="text-[16px] font-medium text-game-ink">{COPY.pool.noOpenPool}</p>
                <p className="mt-1 max-w-prose text-[13px] leading-5 text-game-ink-muted">
                  {COPY.pool.noOpenPoolDetail}
                </p>
              </div>
            )}
          </section>

          {/* ——— The live demo: the toy is the pitch. */}
          <section id="demo" className="mt-12 scroll-mt-20">
            <h2 className="mb-4 max-w-[26ch] font-display text-[28px] font-extrabold leading-8 text-brand-berry sm:text-[34px] sm:leading-10">
              {COPY.howItWorks.pentagonCaption}
            </h2>
            <LiveDemo />
          </section>

          {/* ——— How it works: the five ratified steps, scene stills. */}
          <section className="mt-12">
            <h2 className="mb-4 font-display text-[28px] font-extrabold leading-8 text-brand-berry">
              {COPY.howItWorks.title}
            </h2>
            <ol className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0">
              {COPY.howItWorks.steps.map((step, i) => (
                <li
                  key={step.title}
                  className="w-[240px] shrink-0 snap-start overflow-hidden rounded-2xl bg-brand-cream lg:w-auto"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- local still, fixed card, no next/image needed */}
                  <img src={RAIL_STILLS[i]} alt="" className="aspect-[4/3] w-full object-cover" />
                  <div className="p-4">
                    <p className="font-mono text-[11px] uppercase tracking-wide text-brand-deep-magenta">
                      Step {i + 1}
                    </p>
                    <h3 className="mt-1 font-display text-[17px] font-bold leading-5 text-brand-berry">
                      {step.title}
                    </h3>
                    <p className="mt-2 text-[12px] leading-4.5 text-brand-berry/80">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-4 flex gap-5 text-[13px] text-brand-berry">
              <Link href="/rules" className="underline underline-offset-2">
                {COPY.howItWorks.rulesLink}
              </Link>
              <Link href="/verify" className="underline underline-offset-2">
                {COPY.howItWorks.verifyLink}
              </Link>
            </p>
          </section>

          {/* ——— The fixtures ladder: every tier, open or covered-or-short. */}
          <section className="mt-12">
            <h2 className="mb-3 font-display text-[28px] font-extrabold leading-8 text-brand-berry">
              {COPY.fixtures.title}
            </h2>
            <ul className="overflow-hidden rounded-2xl bg-game-base">
              {TIER_ENTRY_LAMPORTS.map((entry, tier) => {
                const openPool = openByTier.get(tier);
                const status = tierStatus.get(tier);
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
