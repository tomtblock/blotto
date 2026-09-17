'use client';

/*
 * The column beside the blender once the entry is CONFIRMED (founder
 * 2026-09-17, CHANGE-2026-09-16_ui-uplift.md §E): the pass, "Sealed" with
 * the trophy Blott and the rule in two lines, then — where the seal key
 * stood — Post on X and the one-message opt-in, then the way to the pool
 * page and home. It replaces the page-layout pass card (pass-card.tsx) and
 * the sealed panel (sealed-panel.tsx) when the seal stage hosts the flow;
 * the blender stays on screen, blended.
 *
 * Only X is offered (founder: "remove the other share button"). The pass
 * PNG and the intent are pass-card.tsx's, unchanged.
 *
 * THE OPT-IN. A social sign-in that carries an address is one press; a
 * wallet or X sign-in is asked for one. Either way the wallet signs the
 * request (notify/pool-notify.ts) — the record proves the keyholder chose.
 * The control renders only when the page has confirmed the entry service
 * advertises `notify: v2`, so it is never a promise with nothing behind it
 * (the D-E11 rule).
 */

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { MIN_SEATS } from '@blotto/scoring';
import { COPY } from '@/copy';
import { XMark } from '@/wallet/wallet-icons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { BlottSprite } from '@/components/blott/BlottSprite';
import { truncateAddress } from '@/wallet/types';
import { looksLikeEmail, submitPoolNotify, type PoolNotifySigner } from '@/notify/pool-notify';
import { openXWithPass, passPoolLine, passShareTextFor, usePassImage } from './pass-card';

type OptIn =
  | { state: 'idle' }
  | { state: 'prompt'; value: string; error: string | null }
  | { state: 'sending' }
  | { state: 'done'; email: string }
  | { state: 'failed' };

export function EnteredPanel({
  entryIndex,
  asset,
  poolNumber,
  poolAddress,
  wallet,
  signer,
  email,
  apiBase,
  notifyOffered,
}: {
  entryIndex: number;
  asset: string;
  poolNumber?: string | number;
  poolAddress: string;
  wallet: string;
  signer: PoolNotifySigner | undefined;
  /** The sign-in's address, when the provider knows one (types.ts `email`). */
  email: string | null;
  apiBase: string | undefined;
  /** The entry service advertises notify v2 — the opt-in is offered only then. */
  notifyOffered: boolean;
}) {
  const r = COPY.reveal;
  const png = usePassImage(entryIndex, poolNumber);
  const shareText = passShareTextFor(poolNumber);
  const [xNote, setXNote] = useState<string | null>(null);
  const postOnX = useCallback(() => {
    if (!png) return;
    openXWithPass(png, shareText);
    setXNote(r.passShareXNote);
  }, [png, shareText, r]);

  const [optIn, setOptIn] = useState<OptIn>({ state: 'idle' });
  const send = useCallback(
    async (address: string) => {
      setOptIn({ state: 'sending' });
      const out = await submitPoolNotify(apiBase, signer, wallet, poolAddress, address);
      setOptIn(out === 'ok' ? { state: 'done', email: address } : { state: 'failed' });
    },
    [apiBase, signer, wallet, poolAddress]
  );
  const keepUpdated = useCallback(() => {
    if (email) void send(email);
    else setOptIn({ state: 'prompt', value: '', error: null });
  }, [email, send]);

  return (
    <section aria-live="polite" className="flex flex-col gap-4" data-testid="entered-panel">
      <Card tone="light" className="p-5 text-center" data-testid="pass-card">
        <p className="font-mono text-[11px] tracking-[0.16em] uppercase text-brand-berry/70">
          {COPY.shell.title} · {passPoolLine(poolNumber)}
        </p>
        <div className="relative mx-auto mt-1 h-28 w-28">
          <div aria-hidden className="absolute inset-3 rounded-full bg-brand-pale-pink opacity-70 blur-2xl" />
          <BlottSprite pose="cheer" size={112} className="relative" />
        </div>
        <p className="font-display text-[36px] leading-none font-extrabold text-brand-berry">{r.passEntered}</p>
        <p className="mt-2 text-[15px] font-semibold text-brand-berry">{r.cardSeat(entryIndex)}</p>
        <p className="mt-1 font-mono text-[11px] text-brand-berry/60">{truncateAddress(asset)}</p>
      </Card>

      <div className="seal-stage-note">
        <div className="flex items-center gap-3">
          <BlottSprite pose="trophy" size={56} className="shrink-0" />
          <h2 className="font-display text-[28px] leading-8 font-extrabold text-ink">{r.sealedTitle}</h2>
        </div>
        <p className="mt-2 text-[14px] leading-5 text-ink-muted">{COPY.pool.checkBackShort(Number(MIN_SEATS))}</p>
      </div>

      <div className="seal-stage-controls">
        <Button size="lg" className="seal-stage-key" onClick={postOnX} disabled={!png} data-testid="entered-post-x">
          <XMark size={18} />
          <span className="ml-2">{r.passShareX}</span>
        </Button>
        {xNote ? <p className="text-center text-[12px] leading-4 text-brand-berry">{xNote}</p> : null}

        {notifyOffered && optIn.state === 'idle' ? (
          <Button size="lg" className="seal-stage-key seal-stage-key-cream" onClick={keepUpdated} data-testid="keep-updated">
            {COPY.notify.keepUpdated}
          </Button>
        ) : null}
        {notifyOffered && optIn.state === 'prompt' ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const value = optIn.value.trim();
              if (!looksLikeEmail(value)) {
                setOptIn({ state: 'prompt', value: optIn.value, error: COPY.notify.keepUpdatedBadEmail });
                return;
              }
              void send(value);
            }}
          >
            <label htmlFor="keep-updated-email" className="text-[13px] font-semibold text-brand-berry">
              {COPY.notify.keepUpdatedEmailPrompt}
            </label>
            <input
              id="keep-updated-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={optIn.value}
              onChange={(e) => setOptIn({ state: 'prompt', value: e.target.value, error: null })}
              placeholder={COPY.notify.keepUpdatedEmailPlaceholder}
              className="h-12 rounded-full border-2 border-brand-berry/30 bg-brand-cream px-5 text-[15px] text-brand-berry placeholder:text-brand-berry/40 focus:border-brand-berry focus:outline-none"
            />
            {optIn.error ? <p className="text-[12px] text-brand-berry">{optIn.error}</p> : null}
            <Button size="lg" type="submit" className="seal-stage-key seal-stage-key-cream" data-testid="keep-updated-send">
              {COPY.notify.keepUpdatedSend}
            </Button>
          </form>
        ) : null}
        {notifyOffered && optIn.state === 'sending' ? (
          <p className="seal-stage-status">
            <span className="seal-stage-status-ring" aria-hidden="true" />
            {COPY.notify.keepUpdatedSigning}
          </p>
        ) : null}
        {notifyOffered && optIn.state === 'done' ? (
          <p className="text-center text-[13px] leading-5 text-brand-berry" data-testid="keep-updated-done">
            {COPY.notify.keepUpdatedDone(optIn.email)}
          </p>
        ) : null}
        {notifyOffered && optIn.state === 'failed' ? (
          <div className="flex flex-col items-center gap-2">
            <p className="text-center text-[13px] text-brand-berry">{COPY.notify.keepUpdatedFailed}</p>
            <Button intent="quiet" onClick={keepUpdated}>
              {COPY.notify.keepUpdated}
            </Button>
          </div>
        ) : null}
        {notifyOffered && optIn.state === 'idle' ? (
          <p className="text-center text-[12px] leading-4 text-brand-berry/80">{COPY.notify.keepUpdatedNote}</p>
        ) : null}
      </div>

      <p className="flex justify-center gap-5 text-[14px] text-brand-berry">
        <Link href={`/pools/${poolAddress}`} className="underline underline-offset-2 hover:text-brand-deep-magenta">
          {COPY.pool.viewPool}
        </Link>
        <Link href="/" className="underline underline-offset-2 hover:text-brand-deep-magenta">
          {COPY.shell.nav.backToHome}
        </Link>
      </p>
    </section>
  );
}
