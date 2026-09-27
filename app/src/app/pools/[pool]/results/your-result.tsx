'use client';

/*
 * Your result (V2, founder 2026-09-27: "the results page is player-first").
 * For the signed-in player who is in this pool's VERIFIED archive: their
 * position out of the field, their battles won, and three keys — the full
 * leaderboard (an anchor on this page), Verify pool with a "?" that says
 * what verifying does, and Share on X — then the replay of their battles
 * against the winner (or, for the winner, against the player ranked next),
 * and the way to tell us if something looks wrong.
 *
 * SOURCES. Position and battles won are the archive's row (E3: only from a
 * published bundle that recomputed to the on-chain root; nothing renders
 * without one). The replay reads the bundle at the archive's permanent URI
 * in the browser, checks each seat's battles against its committed hash
 * (results/what-beat-you.ts), and shows only what checks out. Nobody's
 * wallet is rendered; the opponent is named by rank.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { BattleSet } from '@blotto/scoring';
import { COPY } from '@/copy';
import type { PoolLeaderboard } from '@/data/types';
import type { PublishedBundle } from '@/verify/logic';
import { useAuth } from '@/wallet/auth-context';
import { NeonSection } from '@/components/ui/neon-section';
import { battlesFromBundle } from '@/results/what-beat-you';
import { battleScoreLabel } from './archive-standings';
import { BattleReplay } from './battle-replay';

const KEY_CREAM = 'key-cream flex h-12 items-center justify-center rounded-full px-5 font-display text-[15px] font-bold uppercase tracking-wide';
const KEY_QUIET =
  'flex h-12 items-center justify-center rounded-full border border-white/25 px-5 font-display text-[15px] font-bold uppercase tracking-wide text-ink hover:border-brand hover:text-brand';

type Bundle = { state: 'idle' } | { state: 'loading' } | { state: 'ready'; battles: Map<number, BattleSet> } | { state: 'failed' };

export function YourResult({ pool, poolId, archive }: { pool: string; poolId: string; archive: PoolLeaderboard | null }) {
  const r = COPY.results.yourResult;
  const auth = useAuth();
  const wallet = auth.status === 'signed-in' ? auth.walletAddress : null;
  const me = useMemo(() => (archive && wallet ? (archive.rows.find((row) => row.player === wallet) ?? null) : null), [archive, wallet]);
  // The opponent: the winner, or for a winner the best-ranked other player.
  const opponent = useMemo(() => {
    if (!archive || !me) return null;
    const others = archive.rows.filter((row) => row.player !== me.player && row.seat !== null);
    return others.sort((a, b) => a.rank - b.rank)[0] ?? null;
  }, [archive, me]);
  const [explain, setExplain] = useState(false);
  const [bundle, setBundle] = useState<Bundle>({ state: 'idle' });
  const uri = archive?.uri ?? null;
  const wantBundle = bundle.state === 'loading';
  useEffect(() => {
    if (!wantBundle || uri === null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(uri, { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const published = (await res.json()) as PublishedBundle;
        if (!cancelled) setBundle({ state: 'ready', battles: battlesFromBundle(published) });
      } catch {
        if (!cancelled) setBundle({ state: 'failed' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wantBundle, uri]);

  if (!archive || !me || wallet === null) return null;

  const mine = bundle.state === 'ready' && me.seat !== null ? (bundle.battles.get(me.seat) ?? null) : null;
  const theirs = bundle.state === 'ready' && opponent && opponent.seat !== null ? (bundle.battles.get(opponent.seat) ?? null) : null;
  const opponentLabel = opponent ? (opponent.rank === 1 ? r.replayWinner : r.replayRank(opponent.rank)) : '';
  const verifyHref = `/verify?pool=${pool}&bundle=${encodeURIComponent(archive.uri)}`;
  const shareOnX = () => {
    const url = `${window.location.origin}/card/${pool}/${wallet}`;
    window.open(
      `https://x.com/intent/post?text=${encodeURIComponent(r.shareText(me.rank, poolId))}&url=${encodeURIComponent(url)}`,
      '_blank',
      'noopener,noreferrer'
    );
  };

  return (
    <NeonSection heading={r.title} data-testid="your-result">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">{r.positionLabel}</p>
          <p className={`tnum font-display text-[48px] leading-none font-extrabold ${me.rank === 1 ? 'text-prize' : 'text-ink'}`}>
            {r.position(me.rank, archive.rows.length)}
          </p>
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">{r.battlesWon}</p>
          <p className="tnum font-display text-[32px] leading-none font-bold text-ink">{r.battlesWonOf(battleScoreLabel(me.recomputed?.score_half))}</p>
        </div>
        {me.amount_lamports !== '0' ? (
          <p className="text-[14px] font-semibold text-prize">{r.paid}</p>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <a href="#standings" className={KEY_CREAM} data-testid="your-result-leaderboard">
          {r.leaderboard}
        </a>
        <Link href={verifyHref} className={KEY_QUIET} data-testid="your-result-verify">
          {r.verify}
        </Link>
        <button
          type="button"
          aria-expanded={explain}
          aria-label={r.verifyWhat}
          title={r.verifyWhat}
          onClick={() => setExplain((e) => !e)}
          className="grid h-9 w-9 place-items-center rounded-full border border-white/25 font-display text-[16px] font-bold text-ink hover:border-brand hover:text-brand"
          data-testid="your-result-verify-why"
        >
          ?
        </button>
        <button type="button" onClick={shareOnX} className={KEY_QUIET} data-testid="your-result-share-x">
          {r.shareX}
        </button>
      </div>
      {explain ? (
        <p className="mt-3 max-w-prose rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-[13px] leading-5 text-ink-muted" data-testid="verify-explainer">
          {r.verifyExplainer}
        </p>
      ) : null}

      {opponent ? (
        <div className="mt-6">
          {bundle.state === 'idle' ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-[14px] leading-5 text-ink-muted">{r.replayTitle(opponentLabel)}</p>
              <button type="button" onClick={() => setBundle({ state: 'loading' })} className={KEY_CREAM} data-testid="replay-open">
                ▶ {r.replayPlay}
              </button>
            </div>
          ) : null}
          {bundle.state === 'loading' ? (
            <p aria-live="polite" className="text-[13px] text-ink-muted">
              {r.replayLoading}
            </p>
          ) : null}
          {bundle.state === 'failed' || (bundle.state === 'ready' && (!mine || !theirs)) ? (
            <p className="text-[13px] leading-5 text-ink-muted">{r.replayUnavailable}</p>
          ) : null}
          {mine && theirs ? <BattleReplay mine={mine} theirs={theirs} opponentLabel={opponentLabel} /> : null}
        </div>
      ) : null}

      <p className="mt-5 text-[13px] leading-5 text-ink-muted">
        {r.feedback}{' '}
        <Link href="/complaints" className="underline underline-offset-2 hover:text-ink">
          {r.feedbackLink}
        </Link>
      </p>
    </NeonSection>
  );
}
