'use client';

/*
 * The career record (R15; restyled by v3 D2, extended by D3): lifetime
 * pools, paid finishes, prize totals in prize amber, the prize-record
 * chart and rivals off the player_history read API, the class collection
 * as artwork shelf. Read-only — nothing here can affect a pool.
 *
 * PHASE-D3-REVIEW: v3 asks for a "rank history" chart. Rank labels are
 * not indexed (D3-B: they live in the published bundle), so the chart is
 * the PRIZE record — amount per tournament in entry order, the paid/unpaid
 * outcome that is on-chain and player-verifiable. Bar heights are display
 * proportions; every displayed amount stays a bigint-derived string.
 */
import { useEffect, useState } from 'react';
import { COPY } from '@/copy';
import { useAuth } from '@/wallet/auth-context';
import { indexerApi, live, type Live } from '@/data/api';
import { lamportsToSol } from '@/data/format';
import type { CareerRow, ProfileRow, RivalRow } from '@/data/types';
import { Card } from '@/components/ui/card';
import { LiveDataUnavailable } from '@/components/shell/live-unavailable';
import { Stat } from '@/components/ui/stat';
import { MyBlots } from './my-blots';

function PrizeRecordChart({ career }: { career: CareerRow[] }) {
  if (career.length < 2) return null;
  const max = career.reduce((m, r) => {
    const v = BigInt(r.amount_lamports);
    return v > m ? v : m;
  }, 0n);
  return (
    <Card className="p-5">
      <h2 className="mb-1 text-[12px] uppercase tracking-[0.14em] text-ink-muted">
        {COPY.career.chartTitle}
      </h2>
      <p className="mb-4 text-[12px] leading-4 text-ink-muted">{COPY.career.chartNote}</p>
      <div className="flex h-28 items-end gap-1.5" role="img" aria-label={COPY.career.chartTitle}>
        {career.map((r) => {
          const v = BigInt(r.amount_lamports);
          // Display proportion only — the amount itself never leaves bigint.
          const h = max > 0n && v > 0n ? Math.max(8, Number((v * 100n) / max)) : 4;
          return (
            <div
              key={`${r.pool}`}
              // E3: rank appears only once the pool's published bundle
              // verified against the on-chain root (null/absent otherwise).
              title={`#${r.entries_to_date}: ${r.paid ? `${lamportsToSol(r.amount_lamports)} SOL` : 'unpaid'}${
                typeof r.rank === 'number' ? ` · ${COPY.results.rank(r.rank)}` : ''
              }`}
              className={
                'w-full max-w-8 rounded-t ' + (r.paid ? 'bg-prize' : 'bg-overlay')
              }
              style={{ height: `${h}%` }}
            />
          );
        })}
      </div>
    </Card>
  );
}

function Rivals({ rivals }: { rivals: RivalRow[] }) {
  if (rivals.length === 0) return null;
  return (
    <Card className="p-5">
      <h2 className="mb-1 text-[12px] uppercase tracking-[0.14em] text-ink-muted">
        {COPY.career.rivalsTitle}
      </h2>
      <p className="mb-4 text-[12px] leading-4 text-ink-muted">{COPY.career.rivalsNote}</p>
      <ul className="flex flex-col gap-2">
        {rivals.map((r) => (
          <li key={r.player} className="flex items-center gap-3">
            <span className="font-mono text-[13px] text-ink">{r.player.slice(0, 8)}…</span>
            <span className="tnum ml-auto text-[13px] text-ink-muted">
              {COPY.career.sharedPools(r.pools_shared)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * What the page shows for a career read (audit 2026-09-11, C-15 / D-16).
 *
 * Pure, and separate from the component, because the distinction it draws
 * is the finding: `null` from the indexer means "this wallet has never
 * entered", and a FAILED read means "we cannot know right now". They used
 * to be the same branch, so an outage told a player with a career that they
 * had no entries.
 */
export type ProfileView = 'loading' | 'unavailable' | 'empty' | { row: ProfileRow };

export function profileView(read: Live<ProfileRow | null> | null): ProfileView {
  if (read === null) return 'loading';
  if (!read.ok) return 'unavailable';
  return read.value === null ? 'empty' : { row: read.value };
}

export function ProfileClient() {
  const auth = useAuth();
  const wallet = auth.status === 'signed-in' ? auth.walletAddress : null;
  // Keyed by wallet so a stale wallet's record renders as loading rather
  // than being cleared synchronously inside the effect (house pattern —
  // matches the balance gate in play-client).
  const [result, setResult] = useState<{
    wallet: string;
    /*
     * C-15 / D-16 (audit 2026-09-11). The career read used to collapse into
     * `row: null` on ANY failure, and `null` is what "this wallet has never
     * entered" looks like — so an indexer outage rendered "No entries yet."
     * to a player with a career. `live()` is the guard the codebase already
     * has for exactly this conflation (data/api.ts): "the indexer says
     * nothing" and "we could not reach the indexer" are different claims,
     * and only one of them is about the player.
     */
    profile: Live<ProfileRow | null>;
    career: CareerRow[];
    rivals: RivalRow[];
  } | null>(null);

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    const api = indexerApi();
    void (async () => {
      const [profile, career, rivals] = await Promise.all([
        live(() => api.getProfile(wallet)),
        // Secondary panels: the chart and the rivals list simply do not
        // render when their read fails. Neither can be mistaken for a
        // statement about the player, so neither degrades the whole page.
        api.getCareer(wallet).catch(() => [] as CareerRow[]),
        api.getRivals(wallet).catch(() => [] as RivalRow[]),
      ]);
      if (!cancelled) setResult({ wallet, profile, career, rivals });
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  const view = profileView(result && result.wallet === wallet ? result.profile : null);

  if (!wallet) {
    return (
      <Card className="flex flex-col gap-2 p-6">
        <p className="text-[17px] font-medium text-ink">Sign in to see your record.</p>
        <p className="max-w-prose text-[13px] leading-5 text-ink-muted">
          Your career — every tournament entered, every paid finish, every character pass —
          is built from on-chain data for the wallet you sign in with.
        </p>
      </Card>
    );
  }
  if (view === 'loading') {
    return (
      <div aria-live="polite" className="flex flex-col items-center gap-4 py-14">
        <div
          className="h-8 w-8 rounded-full border-2 border-overlay border-t-brand motion-safe:animate-rotate"
          aria-hidden
        />
      </div>
    );
  }
  if (view === 'unavailable') {
    // The honest degraded state — never "No entries yet", which is a claim
    // about this player rather than about our own data service.
    return <LiveDataUnavailable />;
  }
  if (view === 'empty') {
    return (
      <Card className="flex flex-col gap-2 p-6">
        <p className="text-[17px] font-medium text-ink">No entries yet.</p>
        <p className="max-w-prose text-[13px] leading-5 text-ink-muted">
          Your first tournament starts your record — the Play tab has the open pool.
        </p>
      </Card>
    );
  }

  const profile = view.row;
  return (
    <div className="animate-rise flex flex-col gap-4">
      <Card className="p-5">
        <h2 className="mb-4 text-[12px] uppercase tracking-[0.14em] text-ink-muted">
          {COPY.profile.lifetime}
        </h2>
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
          <Stat label={COPY.profile.poolsEntered} value={profile.pools_entered} />
          <Stat label={COPY.profile.prizeFinishes} value={profile.seats_paid} tone="brand" />
          <Stat
            label={COPY.profile.totalPrizes}
            value={lamportsToSol(profile.total_won_lamports)}
            unit="SOL"
            tone="prize"
          />
        </div>
      </Card>
      <MyBlots />
      <PrizeRecordChart career={result?.career ?? []} />
      <Rivals rivals={result?.rivals ?? []} />
      <Card className="p-5">
        <h2 className="mb-4 text-[12px] uppercase tracking-[0.14em] text-ink-muted">
          Character collection
        </h2>
        {/* The ONE player-facing surface that names the drawn rarity
            (founder 2026-09-15: profile only, tier names only, with the
            caveat beneath). The per-tier hue is art and stays. */}
        <dl className="grid grid-cols-5 gap-3 text-center">
          {profile.class_counts.map((n, i) => (
            <div key={i} className="flex flex-col gap-1">
              <dt className="text-[10px] uppercase tracking-[0.12em] text-ink-muted">
                {COPY.reveal.rarityNames[i]}
              </dt>
              <dd
                className="tnum font-display text-[28px] leading-[30px] font-bold"
                style={{ color: n > 0 ? `var(--color-class-${i})` : 'var(--color-ink-muted)' }}
              >
                {n}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-[12px] leading-4 text-ink-muted">{COPY.profile.rarityCaveat}</p>
      </Card>
    </div>
  );
}
