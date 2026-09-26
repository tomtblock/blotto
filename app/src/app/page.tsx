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
import { lamportsToSol, poolMode } from '@/data/format';
import type { PoolSummary } from '@/data/types';
import type { BoardMode } from '@/battle/board/mode';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';
import { Countdown } from '@/components/ui/countdown';
import type { ClipTier } from '@/components/landing/HeroClip';
import { AmbientClip } from '@/components/ui/ambient-clip';

/*
 * Founder 2026-09-16 (CHANGE-2026-09-16_ui-uplift.md §A5): the open-pool
 * card carries a looping Blott in a well of its own. The motion rule (one
 * ambient loop per viewport) is kept by AmbientClip: the hero reel pauses
 * once it is mostly scrolled away, the card clip plays only while mostly
 * in view. PHASE-N-REVIEW: the two can overlap for a beat mid-scroll.
 */
const CARD_CLIP: readonly ClipTier[] = [
  { mp4: '/motion/pool/blott-card.mp4', webm: '/motion/pool/blott-card.webm' },
];
const CARD_POSTER = '/motion/pool/blott-card.jpg';

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
import { WelcomeNote } from '@/components/landing/WelcomeNote';

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

/**
 * One open pool as a long playing card (founder Phase B, 2026-09-24): its
 * mode on the top edge, the Blott well, the seat ring, the pot, the entry,
 * the deadline clock, the §8.6 line above the enter control. Two of these
 * sit side by side when an easy and a hard pool are both open; clicking
 * either goes straight down THAT pool's path (`/pools/{pool}`), and the
 * board it reaches reads the pool's mode from the same record.
 *
 * The motion rule (one ambient loop per viewport) is kept by giving the
 * loop to the first card only; a second card wears the same poster still.
 */
function PoolCard({ pool, withClip }: { pool: PoolSummary; withClip: boolean }) {
  const mode = poolMode(pool);
  return (
    <div
      data-testid={`pool-card-${mode}`}
      className="candy candy-gloss relative flex flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,var(--color-overlay)_0%,var(--color-game-raised)_38%,var(--color-game-base)_100%)] p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-game-ink-muted">
          {COPY.landing.openPoolTitle}
        </p>
        <span
          aria-label={COPY.landing.cardModeAria(mode)}
          className="inline-flex items-center rounded-full border border-white/25 px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.1em] text-game-ink shadow-[inset_0_1px_0_rgba(255,246,236,0.14)]"
        >
          {mode === 'hard' ? COPY.board.modeHard : COPY.board.modeEasy}
        </span>
      </div>
      {/* D-E1 §1.4: the pot travels with the pool, not the table. */}
      {BigInt(pool.pot_lamports) !== TIER_POT_LAMPORTS[pool.tier] && (
        <p className="mt-2 text-[12px] leading-5 text-game-ink-muted">{COPY.pool.potFixedAtOpen}</p>
      )}
      {/* The Blott's well: its own frame inside the card, never sharing one
          with a number (tokens.ts: the prize amount and the Blot are both
          yellow). A soft plum fade seats it in the vinyl rather than on it. */}
      <div
        aria-hidden="true"
        className="relative mt-4 aspect-video overflow-hidden rounded-[20px] shadow-[inset_0_0_0_1px_rgba(255,246,236,0.08),inset_0_10px_24px_rgba(42,16,48,0.35)]"
      >
        {withClip ? (
          <AmbientClip
            tiers={CARD_CLIP}
            poster={CARD_POSTER}
            className="absolute inset-0 h-full w-full object-cover"
            playWhenVisible={0.6}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- the clip's own poster, same bytes as the loop's first frame
          <img src={CARD_POSTER} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,var(--color-game-raised)_0%,transparent_28%)]" />
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-6">
        <SeatRing entrants={pool.entrants} />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] uppercase tracking-[0.14em] text-game-ink-muted">
            {COPY.pool.prizeLabel}
          </p>
          <p className="tnum font-display text-[44px] font-extrabold leading-[48px] text-game-prize">
            {lamportsToSol(pool.pot_lamports)}
            <span className="ml-2 font-body text-[15px] font-medium text-game-ink-muted">SOL</span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-game-ink">
            <span className="tnum font-display text-[18px] font-bold">
              {lamportsToSol(pool.entry_lamports)}
              <span className="ml-1 font-body text-[12px] font-medium text-game-ink-muted">
                SOL entry
              </span>
            </span>
            {/* PHASE-E1-REVIEW (D18): this clock already sits in the same
                card as the Enter link, against the rule the Countdown
                documents. Not moved here — flagged for the founder. It
                derives from the server's time; each pool keeps its own. */}
            <Countdown
              deadlineUnix={pool.fill_deadline}
              serverTimeUnix={pool.server_time}
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
        href={`/pools/${pool.pool}`}
        className="key-action mt-3 flex h-14 items-center justify-center rounded-full bg-game-action font-display text-[18px] font-bold uppercase tracking-wide text-game-base hover:brightness-105"
      >
        {COPY.pool.enter}
      </Link>
      <p className="mt-3 text-center text-[11px] text-game-ink-muted">{COPY.pool.ageTerritoryNote}</p>
    </div>
  );
}

/**
 * The hard card before its first pool: shown ONLY when `GET /tiers` says the
 * founder has enabled the hard ladder somewhere and no hard pool is open
 * yet. Data-derived — there is no switch in the app (Phase B plan, 3).
 */
function HardOpensSoonCard() {
  return (
    <div
      data-testid="pool-card-hard-soon"
      className="candy candy-gloss relative flex flex-col overflow-hidden rounded-[24px] border border-dashed border-white/20 bg-[linear-gradient(180deg,var(--color-overlay)_0%,var(--color-game-raised)_38%,var(--color-game-base)_100%)] p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-game-ink-muted">
          {COPY.landing.hardOpensSoonTitle}
        </p>
        <span
          aria-label={COPY.landing.cardModeAria('hard')}
          className="inline-flex items-center rounded-full border border-white/25 px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.1em] text-game-ink shadow-[inset_0_1px_0_rgba(255,246,236,0.14)]"
        >
          {COPY.board.modeHard}
        </span>
      </div>
      <div
        aria-hidden="true"
        className="relative mt-4 aspect-video overflow-hidden rounded-[20px] opacity-60 shadow-[inset_0_0_0_1px_rgba(255,246,236,0.08),inset_0_10px_24px_rgba(42,16,48,0.35)]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- the clip's own poster */}
        <img src={CARD_POSTER} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,var(--color-game-raised)_0%,transparent_28%)]" />
      </div>
      <p className="mt-5 max-w-prose text-[14px] leading-6 text-game-ink">
        {COPY.landing.hardOpensSoonBody}
      </p>
      <p className="mt-auto pt-5 text-center text-[11px] text-game-ink-muted">
        {COPY.pool.ageTerritoryNote}
      </p>
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
  // Phase B (founder 2026-09-24): one card per open pool, the lowest tier of
  // each ladder — easy on the left, hard on the right. The hero's own enter
  // control goes to the easy pool when one is open (the landing demo stays
  // easy), else to the hard one.
  const lowestOf = (mode: BoardMode) => open.find((p) => poolMode(p) === mode);
  const easyOpen = lowestOf('easy');
  const hardOpen = lowestOf('hard');
  const hero = easyOpen ?? hardOpen;
  // The ladder below is the easy ladder's per-tier row; a hard pool open in
  // the same tier gets its own row beneath it.
  const openByTier = new Map(open.filter((p) => poolMode(p) === 'easy').map((p) => [p.tier, p]));
  const hardOpenByTier = new Map(open.filter((p) => poolMode(p) === 'hard').map((p) => [p.tier, p]));
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
  // The hard ladder's enablement, by the same rule: the live Config through
  // `GET /tiers`, else the ground truth of an open hard pool. A read API
  // from before Phase B serves no `hard` — that reads as not enabled, which
  // is true of it. The "Opens soon" card exists only on this signal.
  const hardEnabledByTier = tiersRead
    ? new Map(tiersRead.tiers.map((t) => [t.tier, t.hard?.enabled === true]))
    : new Map([...hardOpenByTier.keys()].map((tier) => [tier, true]));
  const hardEnabledAnywhere = [...hardEnabledByTier.values()].some(Boolean);
  // A tier appears if the founder has opened it, OR if it is still running a
  // pool. The second half matters: `open_tiers` gates `open_pool` and
  // nothing else — `register` never reads it — so closing a tier must not
  // hide a pool that is still taking entries from the players in it.
  const ladder = TIER_ENTRY_LAMPORTS.map((entry, tier) => ({ entry, tier })).filter(
    ({ tier }) =>
      enabledByTier.get(tier) === true ||
      openByTier.has(tier) ||
      hardEnabledByTier.get(tier) === true ||
      hardOpenByTier.has(tier)
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
          <AmbientClip
            tiers={HERO_TIERS}
            poster="/motion/landing/hero_montage_poster.jpg"
            className="absolute inset-0 h-full w-full object-cover"
            playWhenVisible={0.2}
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
                {COPY.landing.tryBoard}
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
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 sm:px-6">

          {/* ——— The open pools: one long card per open pool, side by side
              (founder Phase B). Every number on the game layer. */}
          <section className="mt-10">
            {!poolsLive.ok ? (
              <div className="candy candy-gloss relative overflow-hidden rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,var(--color-overlay)_0%,var(--color-game-raised)_38%,var(--color-game-base)_100%)] p-6">
                <p className="text-[16px] font-medium text-game-ink">{COPY.shell.liveDataUnavailable}</p>
                <p className="mt-1 max-w-prose text-[13px] leading-5 text-game-ink-muted">
                  {COPY.shell.liveDataUnavailableDetail}
                </p>
              </div>
            ) : hero ? (
              <div
                data-testid="pool-cards"
                className={`grid gap-5 ${hardOpen || hardEnabledAnywhere ? 'md:grid-cols-2' : ''}`}
              >
                {easyOpen && <PoolCard pool={easyOpen} withClip />}
                {hardOpen ? (
                  <PoolCard pool={hardOpen} withClip={!easyOpen} />
                ) : hardEnabledAnywhere ? (
                  <HardOpensSoonCard />
                ) : null}
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
            <HowItWorksCarousel steps={COPY.howItWorks.steps(Number(MIN_SEATS))} />
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
            <ul className="candy candy-gloss relative overflow-hidden rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,var(--color-overlay)_0%,var(--color-game-raised)_30%,var(--color-game-base)_100%)]">
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
                    className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/8 px-4 py-3.5 transition-colors sm:px-5 ${
                      openPool ? 'bg-white/5 hover:bg-white/8' : ''
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
                // Phase B: the hard ladder's row at this tier — only where the
                // founder has enabled it or a hard pool is running. Same pot,
                // same entry; the mode is the difference, so it is named.
                const hardPool = hardOpenByTier.get(tier);
                const hardRow =
                  hardPool || hardEnabledByTier.get(tier) === true ? (
                    <div
                      className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/8 px-4 py-3.5 transition-colors sm:px-5 ${
                        hardPool ? 'bg-white/5 hover:bg-white/8' : ''
                      }`}
                    >
                      <span className="tnum w-24 font-display text-[17px] font-bold text-game-ink">
                        {lamportsToSol(entry.toString())}
                        <span className="ml-1 font-body text-[11px] font-medium text-game-ink-muted">SOL</span>
                      </span>
                      <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-game-ink-muted">
                        {COPY.board.modeHard}
                      </span>
                      <span
                        className={`ml-auto text-right text-[12px] ${
                          hardPool ? 'text-game-action' : 'text-game-ink-muted'
                        }`}
                      >
                        {hardPool
                          ? `${COPY.fixtures.statusOpen} · ${COPY.pool.entrantsOf(hardPool.entrants, Number(MIN_SEATS))}`
                          : COPY.landing.hardOpensSoonTitle}
                      </span>
                    </div>
                  ) : null;
                return (
                  <li key={tier}>
                    {openPool ? <Link href={`/pools/${openPool.pool}`}>{row}</Link> : row}
                    {hardRow ? (hardPool ? <Link href={`/pools/${hardPool.pool}`}>{hardRow}</Link> : hardRow) : null}
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
      {/* The founder's note, once per wallet, after sign-in (2026-09-13). */}
      <WelcomeNote />
    </>
  );
}
