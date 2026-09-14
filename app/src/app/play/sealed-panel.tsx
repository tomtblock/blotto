'use client';

/*
 * The sealed confirmation (v3 D2: a designed moment, not a sentence),
 * extended by the founder's brief of 2026-09-09: it must be "super clear"
 * that the player should check back when the pool has reached its field and
 * concluded, and the pool page and the public results/every-battle view are
 * one tap away.
 *
 * THE EMAIL OPT-IN WAS REMOVED HERE (D-E11, founder ruling 2026-09-13).
 *
 * This screen used to offer "Email me when this pool has concluded" and then
 * answer "We will email you when a pool you are in has concluded." Both were
 * promises nothing could keep: no code in this repository can send an email
 * and there is no account with a provider. The opt-in was real — the wallet
 * signed a canonical message and the entry service stored it — which made it
 * worse rather than better, because a player could show what they had agreed
 * to and we could not show we had done it.
 *
 * The ruling is to cut the promise now and build the dispatcher later. The
 * entry service's `POST /notify` route and its store are left in place and
 * dormant; consents already given stay recorded, because they were validly
 * given and deleting a signed record is the worse of the two mistakes. When a
 * dispatcher exists, the opt-in comes back here and this comment goes.
 *
 * The in-app notifications bell is unaffected and still works: it is derived
 * from the read API and delivers to an open tab, which is a thing we actually
 * do rather than a thing we say we will do.
 */

import Link from 'next/link';
import { COPY } from '@/copy';
import { BlottSprite } from '@/components/blott/BlottSprite';
import { Card } from '@/components/ui/card';

export function SealedPanel({ poolAddress }: { poolAddress: string }) {
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
      <BlottSprite pose="trophy" size={148} className="blott-sealed" />
      <h2 className="font-display text-[34px] leading-[38px] font-extrabold text-ink">Sealed</h2>
      <p className="max-w-prose text-[15px] leading-6 text-ink-muted">{COPY.pool.sealed}</p>

      <Card className="flex w-full max-w-md flex-col gap-3 p-5 text-left">
        <h3 className="font-display text-[24px] leading-7 font-bold text-ink">{COPY.pool.checkBackTitle}</h3>
        <p className="text-[15px] leading-6 text-ink">{COPY.pool.checkBack}</p>
      </Card>

      <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
        <Link
          href={`/pools/${poolAddress}`}
          className="key-action flex h-12 flex-1 items-center justify-center rounded-full bg-brand px-6 text-[15px] font-semibold text-(--color-base) transition-colors hover:bg-brand-hot"
        >
          {COPY.pool.viewPool}
        </Link>
        <Link
          href={`/pools/${poolAddress}/results`}
          className="flex h-12 flex-1 items-center justify-center rounded-full border border-white/20 px-6 text-[15px] font-semibold text-ink transition-colors hover:border-brand hover:text-brand"
        >
          {COPY.pool.viewResults}
        </Link>
      </div>
      {/* 2026-09-13: the way home. This screen had two exits, both deeper
          into the pool; the header wordmark was the only route back. */}
      <Link href="/" className="rounded-full text-[14px] text-ink-muted underline underline-offset-2 hover:text-ink">
        {COPY.shell.nav.backToHome}
      </Link>
    </section>
  );
}
