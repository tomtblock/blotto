'use client';

/*
 * The career (R15; restyled by v3 D2, extended by D3; V2 by the founder's
 * review of 2026-09-27): four tabs — Wallet, Record, Prize record, Battle
 * notes. Read-only — nothing here can affect a pool. The character
 * collection (the one surface that named the drawn rarity) came off the
 * page on 2026-09-27; class is cosmetic and is now shown nowhere.
 *
 * The rivals panel (D3, "the wallets most often in your pools") was removed
 * on 2026-09-16 under the founder's data-minimisation ruling of 2026-09-15:
 * a co-entrant graph nothing in scoring, payment or verification needed.
 *
 * PHASE-D3-REVIEW: v3 asks for a "rank history" chart. Rank labels are
 * not indexed (D3-B: they live in the published bundle), so the chart is
 * the PRIZE record — amount per pool in entry order, the paid/unpaid
 * outcome that is on-chain and player-verifiable. Bar heights are display
 * proportions; every displayed amount stays a bigint-derived string.
 */
import { useEffect, useState } from 'react';
import { COPY } from '@/copy';
import { useAuth } from '@/wallet/auth-context';
import { indexerApi, live, type Live } from '@/data/api';
import { lamportsToSol } from '@/data/format';
import type { CareerRow, ProfileRow } from '@/data/types';
import { NeonSection } from '@/components/ui/neon-section';
import { Tabs } from '@/components/ui/tabs';
import { LiveDataUnavailable } from '@/components/shell/live-unavailable';
import { Stat } from '@/components/ui/stat';
import { WalletCard } from '@/components/wallet/wallet-card';
import { BattleNotes } from '@/components/profile/battle-notes';

function PrizeRecordChart({ career }: { career: CareerRow[] }) {
  if (career.length < 2) {
    return <p className="text-[15px] leading-6 text-ink-muted">{COPY.career.chartEmpty}</p>;
  }
  const max = career.reduce((m, r) => {
    const v = BigInt(r.amount_lamports);
    return v > m ? v : m;
  }, 0n);
  return (
    <>
      <p className="mb-4 text-[13px] leading-5 text-ink-muted">{COPY.career.chartNote}</p>
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
              className={'w-full max-w-8 rounded-t ' + (r.paid ? 'bg-prize' : 'bg-overlay')}
              style={{ height: `${h}%` }}
            />
          );
        })}
      </div>
    </>
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

function Record({ view }: { view: ProfileView }) {
  if (view === 'loading') {
    return (
      <div aria-live="polite" className="flex flex-col items-center gap-4 py-14">
        <div className="h-8 w-8 rounded-full border-2 border-overlay border-t-brand motion-safe:animate-rotate" aria-hidden />
      </div>
    );
  }
  // The honest degraded state — never "No entries yet", which is a claim
  // about this player rather than about our own data service.
  if (view === 'unavailable') return <LiveDataUnavailable />;
  if (view === 'empty') {
    return (
      <NeonSection heading={COPY.profile.lifetime}>
        <p className="text-[17px] font-medium text-ink">{COPY.profile.emptyTitle}</p>
        <p className="mt-2 max-w-prose text-[14px] leading-5 text-ink-muted">{COPY.profile.emptyLine}</p>
      </NeonSection>
    );
  }
  const profile = view.row;
  return (
    <NeonSection heading={COPY.profile.lifetime}>
      <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
        <Stat label={COPY.profile.poolsEntered} value={profile.pools_entered} />
        <Stat label={COPY.profile.prizeFinishes} value={profile.seats_paid} tone="brand" />
        <Stat label={COPY.profile.totalPrizes} value={lamportsToSol(profile.total_won_lamports)} unit="SOL" tone="prize" />
      </div>
    </NeonSection>
  );
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
     * has for exactly this conflation (data/api.ts).
     */
    profile: Live<ProfileRow | null>;
    career: CareerRow[];
  } | null>(null);

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    const api = indexerApi();
    void (async () => {
      const [profile, career] = await Promise.all([
        live(() => api.getProfile(wallet)),
        // A secondary panel: the chart simply shows its empty line when its
        // read fails. It cannot be mistaken for a statement about the player.
        api.getCareer(wallet).catch(() => [] as CareerRow[]),
      ]);
      if (!cancelled) setResult({ wallet, profile, career });
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  if (!wallet) {
    return (
      <NeonSection heading={COPY.profile.lifetime}>
        <p className="text-[17px] font-medium text-ink">{COPY.profile.signInFirst}</p>
        <p className="mt-2 max-w-prose text-[14px] leading-5 text-ink-muted">{COPY.profile.signInFirstLine}</p>
      </NeonSection>
    );
  }

  const view = profileView(result && result.wallet === wallet ? result.profile : null);
  return (
    <Tabs
      label={COPY.profile.tabsAria}
      tone="berry"
      tabs={[
        { id: 'wallet', label: COPY.profile.tabs.wallet, content: <WalletCard /> },
        { id: 'record', label: COPY.profile.tabs.record, content: <Record view={view} /> },
        {
          id: 'prize',
          label: COPY.profile.tabs.prize,
          content: (
            <NeonSection heading={COPY.career.chartTitle}>
              <PrizeRecordChart career={result?.wallet === wallet ? result.career : []} />
            </NeonSection>
          ),
        },
        {
          id: 'notes',
          label: COPY.profile.tabs.notes,
          content: (
            <NeonSection heading={COPY.profile.notesTitle}>
              <BattleNotes wallet={wallet} />
            </NeonSection>
          ),
        },
      ]}
    />
  );
}
