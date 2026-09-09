'use client';

/*
 * The sealed confirmation (v3 D2: a designed moment, not a sentence),
 * extended by the founder's brief of 2026-09-09: it must be "super clear"
 * that the player should check back when the pool has reached its field
 * and concluded; they can opt in to an email when a pool they are in has
 * finished; and the pool page and the public results/every-battle view are
 * one tap away.
 *
 * The opt-in reuses the notifications bell's exact mechanism
 * (submitNotifyPreference: the wallet signs the canonical message, the
 * entry service records it) — one preference, whichever surface set it.
 */

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { COPY } from '@/copy';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/wallet/auth-context';
import { submitNotifyPreference } from '@/entry/notify';

const EMAIL_KEY = (wallet: string) => `blotto:notify-email:${wallet}`;

export function SealedPanel({ poolAddress }: { poolAddress: string }) {
  const auth = useAuth();
  const wallet = auth.status === 'signed-in' ? auth.walletAddress : null;
  const [optIn, setOptIn] = useState<'idle' | 'busy' | 'done' | 'failed'>(() => {
    try {
      return wallet && localStorage.getItem(EMAIL_KEY(wallet)) === '1' ? 'done' : 'idle';
    } catch {
      return 'idle';
    }
  });

  const onOptIn = useCallback(async () => {
    if (!wallet || optIn === 'busy') return;
    setOptIn('busy');
    const signer = auth.status === 'signed-in' ? auth.signers.find((s) => s.address === wallet) : undefined;
    const ok = await submitNotifyPreference(process.env.NEXT_PUBLIC_ENTRY_API_URL, signer, wallet, true);
    if (ok) {
      try {
        localStorage.setItem(EMAIL_KEY(wallet), '1');
      } catch {
        /* recorded server-side either way */
      }
    }
    setOptIn(ok ? 'done' : 'failed');
  }, [wallet, optIn, auth]);

  return (
    <section aria-live="polite" className="animate-settle flex flex-col items-center gap-5 py-10 text-center">
      <div className="relative h-16 w-16" aria-hidden>
        <div className="absolute inset-0 rounded-2xl border-2 border-brand" />
        <div className="absolute inset-0 rounded-2xl" style={{ boxShadow: 'var(--glow-action)' }} />
        <svg viewBox="0 0 24 24" className="absolute inset-0 m-auto h-8 w-8 text-brand">
          <path
            d="m5 13 4.5 4.5L19 8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h2 className="font-display text-[34px] leading-[38px] font-extrabold text-ink">Sealed</h2>
      <p className="max-w-prose text-[15px] leading-6 text-ink-muted">{COPY.pool.sealed}</p>

      <div className="flex w-full max-w-md flex-col gap-3 rounded-2xl border border-line bg-raised p-5 text-left">
        <h3 className="font-display text-[24px] leading-7 font-bold text-ink">{COPY.pool.checkBackTitle}</h3>
        <p className="text-[15px] leading-6 text-ink">{COPY.pool.checkBack}</p>
        {wallet && (
          <div className="flex flex-col gap-2 pt-1">
            {optIn === 'done' ? (
              <p className="text-[13px] leading-5 text-ink-muted">{COPY.pool.notifyOptInDone}</p>
            ) : (
              <>
                <Button intent="quiet" disabled={optIn === 'busy'} onClick={onOptIn}>
                  {COPY.pool.notifyOptIn}
                </Button>
                <p className="text-[12px] leading-5 text-ink-muted">{COPY.notify.emailNote}</p>
                {optIn === 'failed' && (
                  <p role="alert" className="text-[12px] leading-5 text-ink-muted">
                    {COPY.notify.emailFailed}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
        <Link
          href={`/pools/${poolAddress}`}
          className="flex h-12 flex-1 items-center justify-center rounded-xl bg-brand px-6 text-[15px] font-semibold text-(--color-base) transition-colors hover:bg-brand-hot"
        >
          {COPY.pool.viewPool}
        </Link>
        <Link
          href={`/pools/${poolAddress}/results`}
          className="flex h-12 flex-1 items-center justify-center rounded-xl border border-line px-6 text-[15px] font-semibold text-ink transition-colors hover:bg-overlay"
        >
          {COPY.pool.viewResults}
        </Link>
      </div>
    </section>
  );
}
