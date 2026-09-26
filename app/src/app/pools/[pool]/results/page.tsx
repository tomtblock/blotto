/*
 * Results + ranking (roadmap 3.5; restyled by v3 D2): the committed payout
 * list staged as a reveal (results-reveal.tsx), the paid-automatically
 * state (R10 — no claim step), escrow copy where a share is held, and the
 * Verify path always on screen.
 *
 * Round four A2 (founder 2026-09-17): the pink field, "Pool #N" on the
 * marquee with a Results chip beside it, and every block a titled neon
 * box — the payout list, what finished above you, the appeal, the seven,
 * the standings, every battle — with the Verify key at the foot.
 */
import { notFound } from 'next/navigation';
import { COPY } from '@/copy';
import { indexerApi, live } from '@/data/api';
import { lamportsToSol, poolMode } from '@/data/format';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';
import { BackLink } from '@/components/ui/back-link';
import { MarqueeHeading } from '@/components/ui/marquee-heading';
import { NeonSection } from '@/components/ui/neon-section';
import { Pill } from '@/components/ui/pill';
import { SiteFooter } from '@/components/shell/site-footer';
import { LiveDataUnavailable } from '@/components/shell/live-unavailable';
import { ResultsReveal, VerifyAlways, type RevealRow } from './results-reveal';
import { ArchiveStandings } from './archive-standings';
import { AllBattles } from './all-battles';
import { WhatBeatYouPanel } from './what-beat-you-panel';
import { ShareResult } from './share-result';
import { PaidConfetti } from './paid-confetti';
import { ChallengeClient } from './challenge-client';

export default async function ResultsPage({ params }: { params: Promise<{ pool: string }> }) {
  const { pool: poolId } = await params;
  const api = indexerApi();
  // SSR outage guard: unreachable indexer ≠ nonexistent pool or results.
  const pageLive = await live(async () => {
    const pool = await api.getPool(poolId);
    if (!pool) return null;
    const [results, payouts, entries, archive] = await Promise.all([
      api.getResults(poolId),
      api.getPayouts(poolId),
      api.getEntries(poolId),
      // E3: null unless the published bundle verified against the on-chain
      // root — the section below simply does not render without it.
      api.getLeaderboard(poolId),
    ]);
    return { pool, results, payouts, entries, archive };
  });
  if (!pageLive.ok) {
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
  if (!pageLive.value) notFound();
  const { pool, results, payouts, entries, archive } = pageLive.value;
  // D3-B under D-E2: the committed list is keyed by seat and one place is
  // paid, so the paid set is a single row unless a tie for first splits the
  // pot across several. Rank labels are not on-chain — the verify page
  // recomputes them from the published data.
  const payoutBySeat = new Map(payouts.map((p) => [p.seat, p]));
  const entryBySeat = new Map(entries.map((e) => [e.idx, e]));
  const rows: RevealRow[] = [...results]
    .sort((a, b) =>
      BigInt(a.amount) < BigInt(b.amount) ? 1 : BigInt(a.amount) > BigInt(b.amount) ? -1 : a.seat - b.seat
    )
    .map((r) => {
      const payout = payoutBySeat.get(r.seat);
      const entry = entryBySeat.get(r.seat);
      const held = Boolean(payout && payout.escrowed && entry?.escrow_settled !== 'released');
      return {
        seat: r.seat,
        player: entry?.player ?? '',
        playerShort: entry ? `${entry.player.slice(0, 8)}…` : '—',
        amountSol: held ? null : lamportsToSol(r.amount),
      };
    });

  return (
    <>
      <AppHeader />
      <div className="flex-1 bg-brand-pink">
      <main id="main" className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24">
        <div className="mb-2">
          <BackLink href={`/pools/${pool.pool}`} tone="berry">
            {COPY.shell.nav.backToPool}
          </BackLink>
        </div>
        <header className="mb-6 flex flex-wrap items-center gap-3">
          <MarqueeHeading as="h1">{COPY.reveal.passPool(pool.id)}</MarqueeHeading>
          <Pill tone="field">{COPY.results.title}</Pill>
          {/* Phase B: which rule this pool played. */}
          <Pill tone="ink">{poolMode(pool) === 'hard' ? COPY.board.modeHard : COPY.board.modeEasy}</Pill>
        </header>
        {pool.state === 'Paid' && (
          <p className="-mt-2 mb-6 max-w-prose text-[15px] leading-6 font-medium text-brand-berry">
            {COPY.results.paidAutomatically}
          </p>
        )}
        <div className="flex flex-col gap-10">
        {results.length === 0 ? (
          <NeonSection heading={COPY.results.title}>
            <p className="text-[17px] font-medium text-ink">Results are not committed yet.</p>
            <p className="mt-2 max-w-prose text-[14px] leading-5 text-ink-muted">
              When the pool seals, the pool secret is published and results are committed
              on-chain — this page fills in at that moment, and everything on it can be
              recomputed on the Verify page.
            </p>
          </NeonSection>
        ) : (
          <>
            <NeonSection heading={COPY.results.title} data-testid="results-box">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-1">
                <ResultsReveal rows={rows} />
              </div>
              <p className="mt-4 max-w-prose text-[13px] leading-5 text-ink-muted">
                {COPY.results.tieNote}
              </p>
              {/* The player's own result card, once results are in. */}
              <div className="mt-5">
                <ShareResult
                  pool={pool.pool}
                  seatByPlayer={Object.fromEntries(entries.map((e) => [e.player, e.idx]))}
                  paidSeats={results.filter((r) => BigInt(r.amount) > 0n).map((r) => r.seat)}
                />
              </div>
            </NeonSection>
            {/* v3 D3: browser-side decrypt + re-score of the seats above
                yours, and the share card for your own result. */}
            {/* F-07: "above" is decided by RANK, which lives in the
                verified archive — never by the payout amount, which under
                D-E2 can only ever name the winner. */}
            <WhatBeatYouPanel
              pool={pool.pool}
              secretHex={pool.secret}
              archive={archive}
              seatByPlayer={Object.fromEntries(entries.map((e) => [e.player, e.idx]))}
            />
            <PaidConfetti
              pool={pool.pool}
              paidPlayers={results
                .filter((r) => BigInt(r.amount) > 0n)
                .map((r) => entryBySeat.get(r.seat)?.player ?? '')
                .filter(Boolean)}
            />
            {/* The way to contest a decision on this pool, for the
                signed-in wallet whose own share was forfeited — nobody else
                sees it. It was the appeal panel until 2026-09-19, when the
                named-reviewer apparatus came out of the product: a challenge
                now goes through the complaints route, which a person reads
                and answers within the published windows. */}
            <ChallengeClient
              pool={pool.pool}
              forfeitedPlayers={entries
                .filter((e) => e.escrow_settled === 'forfeited')
                .map((e) => e.player)}
            />
            {archive && <ArchiveStandings archive={archive} />}
            {/* Founder 2026-09-09: every battle of every player, from the
                same verified bundle, after the reveal. */}
            {archive && <AllBattles uri={archive.uri} />}
          </>
        )}
        <VerifyAlways pool={pool.pool} bundleUri={archive?.uri} />
        </div>
      </main>
      </div>
      <SiteFooter />
      <TabBar />
    </>
  );
}
