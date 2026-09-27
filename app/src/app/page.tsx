/*
 * The landing — the Blot world's front door (master prompt D, v4; V2 by
 * the founder's review of 2026-09-27). Brand layer: hot-pink page, yellow
 * inflated headline, the montage reel. Game layer: the ONE pool picker
 * (Easy / Hard toggle, tier filter — components/landing/PoolPicker) and the
 * board demo. Every number on this page lives on plum, inside the picker.
 *
 * Server component; live data via the indexer seam exactly as before. A
 * dead indexer degrades the picker, never the page.
 *
 * Removed in V2 (founder 2026-09-27): the two side-by-side pool cards, the
 * "Opens soon" card and the per-tier "Prize pools" ladder — the picker's
 * tier filter is the one place every tier is listed.
 */
import Link from 'next/link';
import { MIN_SEATS, TIER_ENTRY_LAMPORTS, TIER_POT_LAMPORTS } from '@blotto/scoring';
import { COPY } from '@/copy';
import { indexerApi, live } from '@/data/api';
import { poolMode } from '@/data/format';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';
import { SiteFooter } from '@/components/shell/site-footer';
import { LiveDataUnavailable } from '@/components/shell/live-unavailable';
import type { ClipTier } from '@/components/landing/HeroClip';
import { AmbientClip } from '@/components/ui/ambient-clip';
import { LiveDemo } from '@/components/landing/LiveDemo';
import { HowItWorksCarousel } from '@/components/landing/HowItWorksCarousel';
import { PoolPicker, type PickerTier } from '@/components/landing/PoolPicker';
import { PreloaderGate } from '@/components/preloader/PreloaderGate';
import { WelcomeNote } from '@/components/landing/WelcomeNote';

/**
 * The hero reel in three cuts of the same 2160p master (founder
 * 2026-09-09: 4K, super clear). A wide screen streams the 2160p cut, a
 * laptop the 1080p, a phone the 720p — the browser picks the first tier
 * whose media query matches.
 */
const HERO_TIERS: readonly ClipTier[] = [
  { mp4: '/motion/landing/hero_montage_2160.mp4', webm: '/motion/landing/hero_montage_2160.webm', media: '(min-width: 1600px)' },
  { mp4: '/motion/landing/hero_montage_1080.mp4', webm: '/motion/landing/hero_montage_1080.webm', media: '(min-width: 768px)' },
  { mp4: '/motion/landing/hero_montage.mp4', webm: '/motion/landing/hero_montage.webm' },
];

/* Section headings share one scale (founder 2026-09-27: "make sure the
 * headings are the same"). The demo heading sits on one line from lg. */
const H2 = 'font-display text-[28px] font-extrabold leading-8 text-brand-berry sm:text-[34px] sm:leading-10';

export default async function LandingPage() {
  const api = indexerApi();
  // SSR outage guard: a dead indexer degrades this page, never kills it.
  const [poolsLive, tiersLive] = await Promise.all([live(() => api.listPools()), live(() => api.getTiers())]);
  const pools = poolsLive.ok ? poolsLive.value : [];
  const open = pools.filter((p) => p.state === 'Open');
  // One pool per ladder per tier is open at a time in production; the
  // fixture catalogue holds several, and the FIRST listed is the one every
  // surface (and the journey test) treats as the tier's open pool.
  const openByTier = (mode: 'easy' | 'hard') => {
    const m = new Map<number, (typeof open)[number]>();
    for (const p of open) if (poolMode(p) === mode && !m.has(p.tier)) m.set(p.tier, p);
    return m;
  };
  const easyByTier = openByTier('easy');
  const hardByTier = openByTier('hard');
  // WHICH TIERS THE FOUNDER HAS OPENED — read, never assumed (founder
  // instruction 2026-09-12 §2.3). `GET /tiers` resolves it from the live
  // Config account; on an outage the ground truth in `/pools` stands in (a
  // tier holding an Open pool is open by construction).
  const tiersRead = tiersLive.ok ? tiersLive.value : null;
  const easyEnabled = tiersRead
    ? new Map(tiersRead.tiers.map((t) => [t.tier, t.enabled]))
    : new Map([...easyByTier.keys()].map((tier) => [tier, true]));
  const hardEnabled = tiersRead
    ? new Map(tiersRead.tiers.map((t) => [t.tier, t.hard?.enabled === true]))
    : new Map([...hardByTier.keys()].map((tier) => [tier, true]));
  const pickerTiers: PickerTier[] = TIER_ENTRY_LAMPORTS.map((entry, tier) => ({
    tier,
    entryLamports: entry.toString(),
    potLamports: TIER_POT_LAMPORTS[tier]!.toString(),
    easy: easyByTier.get(tier) ?? null,
    hard: hardByTier.get(tier) ?? null,
    easyEnabled: easyEnabled.get(tier) === true,
    hardEnabled: hardEnabled.get(tier) === true,
  }));
  const serverTime = tiersRead?.server_time ?? open[0]?.server_time ?? null;

  return (
    <>
      {/* First-visit curtain — root route only (the gate reads its flag
          client-side); deep links never mount it. */}
      <PreloaderGate />
      <AppHeader />
      <div className="bg-brand-pink">
        {/* ——— Hero (founder 2026-09-09): the montage covers the whole hero and
            the words sit stacked, left-aligned, on a plum scrim. Poster-first,
            muted, looping, and a still under reduced motion. The section is
            full-bleed; everything below stays in the 5xl column. */}
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
            <h1 className="focus:outline-none max-w-[12ch] font-display text-[64px] font-extrabold uppercase leading-[0.92] tracking-tight whitespace-pre-line text-brand-yellow [text-shadow:0_5px_0_rgba(42,16,48,0.35)] sm:text-[96px] lg:text-[116px]">
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
              {/* Founder 2026-09-27: with two boards, the hero's control cannot
                  name a pool — it takes the player to the picker. */}
              <a
                href="#pick"
                data-testid="hero-choose"
                className="rounded-full bg-brand-yellow px-8 py-3.5 font-display text-[18px] font-bold uppercase tracking-wide text-game-base shadow-[0_6px_20px_rgba(42,16,48,0.35)] hover:bg-brand-cream"
              >
                {COPY.landing.chooseYourPool}
              </a>
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
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-10 sm:px-6">
          {/* ——— The picker: one card, both boards, every tier. */}
          <section className="mt-10">
            {!poolsLive.ok ? <LiveDataUnavailable /> : <PoolPicker tiers={pickerTiers} serverTime={serverTime} />}
          </section>

          {/* ——— The live demo: the toy is the pitch. */}
          <section id="demo" className="mt-14 scroll-mt-20">
            <h2 className={`mb-4 ${H2} lg:whitespace-nowrap`}>{COPY.howItWorks.pentagonCaption}</h2>
            <LiveDemo />
          </section>

          {/* ——— How it works: the five ratified steps, one animated scene at a time. */}
          <section className="mt-14">
            <h2 className={`mb-4 ${H2}`}>{COPY.howItWorks.title}</h2>
            <HowItWorksCarousel steps={COPY.howItWorks.steps(Number(MIN_SEATS))} />
          </section>
        </main>
        {/* Founder 2026-09-27: every relevant link at the foot of the page —
            the one footer the other pages already carry. */}
        <SiteFooter className="text-brand-berry [&_a]:text-brand-berry [&_p]:text-brand-berry" />
      </div>
      <TabBar />
      {/* The founder's note, once per wallet, after sign-in (2026-09-13). */}
      <WelcomeNote />
    </>
  );
}
