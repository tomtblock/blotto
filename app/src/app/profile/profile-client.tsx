'use client';

/*
 * The profile (R15; restyled by v3 D2, extended by D3; V3 by the founder's
 * feedback of 2026-09-27): ONE dashboard — the wallet, the lifetime record,
 * the previous finishes (components/profile/finishes.tsx). Read-only —
 * nothing here can affect a pool.
 *
 * Gone in V3: the tabs, the prize-record chart and the battle notes (the
 * founder's call; the notes were the one thing this page stored, so the
 * browser now holds nothing for the profile). Gone earlier: the character
 * collection (2026-09-27; class is cosmetic and is shown nowhere) and the
 * rivals panel (2026-09-16, the data-minimisation ruling).
 */
import { useEffect, useState } from 'react';
import { COPY } from '@/copy';
import { useAuth } from '@/wallet/auth-context';
import { indexerApi, live, type Live } from '@/data/api';
import { lamportsToSol } from '@/data/format';
import type { CareerRow, ProfileRow } from '@/data/types';
import { NeonSection } from '@/components/ui/neon-section';
import { LiveDataUnavailable } from '@/components/shell/live-unavailable';
import { Stat } from '@/components/ui/stat';
import { WalletCard } from '@/components/wallet/wallet-card';
import { Finishes, finishRows } from '@/components/profile/finishes';

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
    /** Each pool's fill deadline (the finishes table's date), by address. */
    closedByPool: Map<string, string>;
  } | null>(null);

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    const api = indexerApi();
    void (async () => {
      const [profile, career, pools] = await Promise.all([
        live(() => api.getProfile(wallet)),
        // A secondary panel: the table simply shows its empty line when its
        // read fails. It cannot be mistaken for a statement about the player.
        api.getCareer(wallet).catch(() => [] as CareerRow[]),
        api.listPools().catch(() => []),
      ]);
      if (!cancelled) setResult({ wallet, profile, career, closedByPool: new Map(pools.map((p) => [p.pool, p.fill_deadline])) });
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

  const mine = result && result.wallet === wallet ? result : null;
  const view = profileView(mine ? mine.profile : null);
  return (
    <div className="flex flex-col gap-10" data-testid="profile-dashboard">
      <WalletCard />
      <Record view={view} />
      <NeonSection heading={COPY.profile.finishes.title} data-testid="finishes">
        <Finishes rows={mine ? finishRows(mine.career, mine.closedByPool) : []} />
      </NeonSection>
    </div>
  );
}
