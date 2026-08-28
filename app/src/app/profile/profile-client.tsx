'use client';

/*
 * The career record (R15; restyled by v3 D2): lifetime pools, paid
 * finishes, prize totals in prize amber, the class collection as artwork
 * shelf. Read-only — nothing here can affect a pool. D3 adds the rank
 * history chart and rivals from the player_history read API.
 */
import { useEffect, useState } from 'react';
import { COPY } from '@/copy';
import { useAuth } from '@/wallet/auth-context';
import { indexerApi } from '@/data/api';
import { lamportsToSol } from '@/data/format';
import type { ProfileRow } from '@/data/types';
import { Card } from '@/components/ui/card';
import { Stat } from '@/components/ui/stat';

export function ProfileClient() {
  const auth = useAuth();
  const wallet = auth.status === 'signed-in' ? auth.walletAddress : null;
  // Keyed by wallet so a stale wallet's record renders as loading rather
  // than being cleared synchronously inside the effect (house pattern —
  // matches the balance gate in play-client).
  const [result, setResult] = useState<{ wallet: string; row: ProfileRow | null } | null>(null);

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    indexerApi()
      .getProfile(wallet)
      .then((row) => {
        if (!cancelled) setResult({ wallet, row });
      })
      .catch(() => {
        if (!cancelled) setResult({ wallet, row: null });
      });
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  const profile: ProfileRow | null | 'loading' =
    result && result.wallet === wallet ? result.row : 'loading';

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
  if (profile === 'loading') {
    return (
      <div aria-live="polite" className="flex flex-col items-center gap-4 py-14">
        <div
          className="h-8 w-8 rounded-full border-2 border-overlay border-t-brand motion-safe:animate-rotate"
          aria-hidden
        />
      </div>
    );
  }
  if (!profile) {
    return (
      <Card className="flex flex-col gap-2 p-6">
        <p className="text-[17px] font-medium text-ink">No entries yet.</p>
        <p className="max-w-prose text-[13px] leading-5 text-ink-muted">
          Your first tournament starts your record — the Play tab has the open pool.
        </p>
      </Card>
    );
  }

  return (
    <div className="animate-rise flex flex-col gap-4">
      <Card className="p-5">
        <h2 className="mb-4 text-[12px] uppercase tracking-[0.14em] text-ink-muted">
          {COPY.profile.lifetime}
        </h2>
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
          <Stat label="Pools entered" value={profile.pools_entered} />
          <Stat label="Paid finishes" value={profile.seats_paid} tone="brand" />
          <Stat
            label="Total prizes"
            value={lamportsToSol(profile.total_won_lamports)}
            unit="SOL"
            tone="prize"
          />
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="mb-4 text-[12px] uppercase tracking-[0.14em] text-ink-muted">
          Character collection
        </h2>
        <dl className="grid grid-cols-5 gap-3 text-center">
          {profile.class_counts.map((n, i) => (
            <div key={i} className="flex flex-col gap-1">
              <dt className="text-[10px] uppercase tracking-[0.12em] text-ink-muted">
                {COPY.reveal.classNames[i]}
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
      </Card>
    </div>
  );
}
