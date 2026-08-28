/*
 * The landing page (UI constitution PART 6.1): the door, the explainer,
 * the proof band.
 *
 * Act ORDER is reconciled against the D2 contract rather than copied from
 * the constitution verbatim: the constitution reads explainer → proof →
 * door, but the ratified v3 D2 requirement (e2e-asserted) pins the door to
 * the top — the 18+/territory line must be in the first viewport on a
 * phone, next to the one enter CTA, and there is exactly one link named
 * "Enter this tournament" on the page. So the scroll runs door → Act I
 * explainer → Act II proof band, which still passes the cold-visitor test:
 * the room first, then how the game works, then the receipts. Recorded in
 * the phase report.
 *
 * Server component; live data via the indexer seam, degrading honestly.
 * Tier constants come from the shared scoring module — never hand-typed.
 */
import Link from 'next/link';
import { TIER_ENTRY_LAMPORTS, TIER_POT_LAMPORTS } from '@blotto/scoring';
import { COPY } from '@/copy';
import { indexerApi, live } from '@/data/api';
import { proofBand } from '@/data/winners';
import { LiveDataUnavailable } from '@/components/shell/live-unavailable';
import { lamportsToSol } from '@/data/format';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';
import { Card } from '@/components/ui/card';
import { Stat } from '@/components/ui/stat';
import { Countdown } from '@/components/ui/countdown';
import { LivePoolRing } from '@/components/pool/live-pool-ring';
import { buttonClasses } from '@/components/ui/button';
import { FadeInView } from '@/components/ui/fade-in-view';
import { HowItWorksExplainer } from '@/components/home/how-it-works-explainer';
import { ProofBandSection } from '@/components/home/proof-band';

export default async function PlayPage() {
  const api = indexerApi();
  // SSR outage guard: a dead indexer degrades this page, never kills it.
  const [poolsLive, treasuryLive] = await Promise.all([
    live(() => api.listPools()),
    live(() => api.getTreasury()),
  ]);
  const pools = poolsLive.ok ? poolsLive.value : [];
  const treasury = treasuryLive.ok ? treasuryLive.value : null;
  const proof = poolsLive.ok ? await proofBand(api, pools) : null;
  const open = pools
    .filter((p) => p.state === 'Open')
    .sort((a, b) => a.tier - b.tier);
  const hero = open[0];
  const others = open.slice(1);
  const openTiers = new Set(open.map((p) => p.tier));
  const lockedTiers = TIER_ENTRY_LAMPORTS.map((_, tier) => tier).filter(
    (tier) => !openTiers.has(tier)
  );
  const tierStatus = new Map(treasury?.tiers.map((t) => [t.tier, t]) ?? []);

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-24">
        <h1 className="mb-5 max-w-[22ch] font-display text-[34px] leading-[38px] font-extrabold text-ink sm:text-[56px] sm:leading-[58px]">
          {COPY.shell.tagline}
        </h1>

        {/* Act III — the door. The current open pool as the live seat ring:
            real occupancy, WARMTH at true intensity, one primary CTA. The
            room is visibly warm and the door is open; that is the entire
            sales pitch. */}
        {!poolsLive.ok ? (
          <LiveDataUnavailable />
        ) : hero ? (
          <Card live className="p-5">
            <div className="flex items-center gap-5">
              <LivePoolRing pool={hero} size={116} riser />
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
              className={buttonClasses('primary', 'lg') + ' mt-5 w-full'}
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

        {/* Constraint 5: static, fully opaque, never animated, never under
            a sticky element — and in the first viewport on a phone. */}
        <p className="mt-3 text-center text-[12px] tracking-[0.02em] text-ink-muted">
          {COPY.pool.ageTerritoryNote}
          {' · '}
          <Link href="/rules" className="underline underline-offset-2 hover:text-ink">
            {COPY.rules.titleShort}
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

        {/* Act I — the hero explainer: the whole game in ~12 seconds.
            Scroll-scrubbed on desktop, gentle autoplay on mobile, a static
            three-panel strip under reduced motion. The page's one hero
            animation. */}
        <section className="mt-10">
          <h2 className="mb-4 font-display text-[24px] leading-[30px] font-bold text-ink">
            {COPY.howItWorks.title}
          </h2>
          <HowItWorksExplainer />
          <FadeInView className="mt-3">
            <p className="mx-auto max-w-[40ch] text-center text-[14px] leading-5 text-ink-muted">
              {COPY.howItWorks.pentagonCaption}
            </p>
          </FadeInView>

          {/* The full mechanics in plain words — reference text, silent by
              design (the explainer above is the hero; text does not
              compete). */}
          <ol className="mt-6 flex flex-col gap-3">
            {COPY.howItWorks.steps.map((step, i) => (
              <li
                key={step.title}
                className="flex gap-4 rounded-xl border border-line px-4 py-4"
              >
                <span
                  aria-hidden
                  className="tnum font-display text-[20px] leading-6 font-bold text-brand"
                >
                  {i + 1}
                </span>
                <div className="flex flex-col gap-1">
                  <h3 className="text-[15px] font-semibold text-ink">{step.title}</h3>
                  <p className="max-w-prose text-[13px] leading-5 text-ink-muted">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-4 flex gap-5 text-[13px]">
            <Link href="/rules" className="link-draw text-brand">
              {COPY.howItWorks.rulesLink}
            </Link>
            <Link href="/verify" className="link-draw text-brand">
              {COPY.howItWorks.verifyLink}
            </Link>
          </p>
        </section>

        {/* Act II — the proof band: the winners drift and the paid-out
            counter, all of it on-chain data with Verify links. */}
        {proof ? <ProofBandSection data={proof} /> : null}

        {poolsLive.ok && lockedTiers.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-[12px] uppercase tracking-[0.14em] text-ink-muted">
              {COPY.fixtures.title}
            </h2>
            <ul className="flex flex-col gap-2">
              {lockedTiers.map((tier) => {
                const status = tierStatus.get(tier);
                const label =
                  status?.status === 'settling'
                    ? COPY.fixtures.statusSettling
                    : status?.status === 'openable'
                      ? COPY.fixtures.statusOpenable
                      : COPY.fixtures.statusShort;
                const shortBy =
                  status?.status === 'short' && BigInt(status.short_by_lamports) > 0n
                    ? COPY.fixtures.shortBy(lamportsToSol(status.short_by_lamports))
                    : null;
                const covered = status?.status === 'openable' || status?.status === 'settling';
                return (
                  <li
                    key={tier}
                    className={
                      'flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-4 py-3 ' +
                      (covered ? 'border-brand/40' : 'border-line/60')
                    }
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className={'h-4 w-4 ' + (covered ? 'text-brand' : 'text-ink-muted')}
                      aria-hidden
                    >
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
                    <span
                      className={
                        'ml-auto text-right text-[12px] ' +
                        (covered ? 'text-brand' : 'text-ink-muted')
                      }
                    >
                      {label}
                      {shortBy ? (
                        <span className="tnum block text-[11px] text-ink-muted">{shortBy}</span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </main>
      <TabBar />
    </>
  );
}
