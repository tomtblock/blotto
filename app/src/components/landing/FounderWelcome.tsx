'use client';

/*
 * The founder's welcome (2026-09-13): a personal note, bottom-right of the
 * home page, the first time a wallet is signed in — then never again for
 * that wallet. The founder liked the FORMAT of a message they saw elsewhere
 * (avatar, a first name, "just now", a card in the corner); the words here
 * are written to PID §8.7 and are theirs to re-voice (copy/index.ts →
 * welcome).
 *
 * Behaviour: appears ~1 s after sign-in resolves on `/`, dismisses on the
 * close button, Escape, or the call to action; remembers the dismissal per
 * wallet in localStorage (try/catch — a private window or blocked storage
 * simply shows it again). A polite live region, not a dialog: it never
 * traps focus or blocks the page. Sits above the tab bar at every width.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { COPY } from '@/copy';
import { useAuth } from '@/wallet/auth-context';
import { Card } from '@/components/ui/card';
import { BlottSprite } from '@/components/blott/BlottSprite';

const KEY = (wallet: string) => `blotto:welcomed:${wallet}`;
const APPEAR_MS = 900;

export function FounderWelcome() {
  const { status, walletAddress } = useAuth();
  const [open, setOpen] = useState(false);
  const w = COPY.welcome;

  useEffect(() => {
    if (status !== 'signed-in' || !walletAddress) return;
    try {
      if (localStorage.getItem(KEY(walletAddress))) return;
    } catch {
      /* storage unavailable: show it; it is a note, not a gate */
    }
    const t = setTimeout(() => setOpen(true), APPEAR_MS);
    return () => clearTimeout(t);
  }, [status, walletAddress]);

  const dismiss = useCallback(() => {
    setOpen(false);
    if (!walletAddress) return;
    try {
      localStorage.setItem(KEY(walletAddress), new Date().toISOString());
    } catch {
      /* fine — it will show once more next time */
    }
  }, [walletAddress]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismiss]);

  if (!open) return null;

  return (
    <aside
      role="status"
      aria-live="polite"
      aria-label={w.greeting}
      data-testid="founder-welcome"
      className="fixed right-4 bottom-[calc(4rem+1rem+env(safe-area-inset-bottom))] z-50 w-[min(24rem,calc(100vw-2rem))] animate-rise sm:right-6"
    >
      <Card tone="light" className="p-5">
        <button
          type="button"
          onClick={dismiss}
          aria-label={w.dismiss}
          className="absolute top-3 right-3 grid h-9 w-9 place-items-center rounded-full text-brand-berry/60 hover:bg-brand-pale-pink/60 hover:text-brand-berry"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <div className="flex items-start gap-3">
          <div className="relative -mt-1 -ml-1 h-14 w-14 shrink-0">
            <BlottSprite pose="wave" size={56} label={w.founderName} />
          </div>
          <div className="min-w-0 pr-8">
            <h2 className="font-display text-[22px] leading-6 font-extrabold text-brand-berry">{w.greeting}</h2>
            <div className="mt-2 flex flex-col gap-2 text-[14px] leading-5 text-brand-berry/90">
              {w.paragraphs.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
            <p className="mt-3 text-[12px] text-brand-berry/60">
              {w.founderName} · {w.founderRole} · {w.justNow}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/pools"
                onClick={dismiss}
                className="inline-flex h-10 items-center rounded-full bg-brand-berry px-5 text-[14px] font-semibold text-brand-cream hover:bg-brand-deep-magenta"
              >
                {w.cta}
              </Link>
              <button
                type="button"
                onClick={dismiss}
                className="inline-flex h-10 items-center rounded-full border border-brand-berry/30 px-5 text-[14px] text-brand-berry hover:border-brand-berry"
              >
                {w.dismiss}
              </button>
            </div>
          </div>
        </div>
      </Card>
    </aside>
  );
}
