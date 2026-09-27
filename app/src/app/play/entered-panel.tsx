'use client';

/*
 * The success screen (V2, founder 2026-09-27, sketches D and E): the end
 * of the entry flow, and terminal — there is no Continue and no dismiss.
 * The petals clip over the pass ("I'm in.", the seat, the asset), "Sealed"
 * with the rule in two lines, then Post on X, the one-message opt-in and
 * Play again, which goes home. The trophy Blott, the "one message…" note
 * and the two small links it used to carry are gone by the same review.
 *
 * Only X is offered (founder: "remove the other share button"). V3
 * (founder, the same day): the card is bigger, its pool line names the
 * mode, and Post on X opens the intent with the founder's line and
 * nothing else — the pass PNG that downloaded beside it ("looks like a
 * virus") and the note that explained it are gone, with the canvas that
 * drew it. What is posted is the pool and the seat: nothing sealed.
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
import { AmbientClip } from '@/components/ui/ambient-clip';
import type { BoardMode } from '@/battle/board/mode';
import { truncateAddress } from '@/wallet/types';
import { looksLikeEmail, submitPoolNotify, type PoolNotifySigner } from '@/notify/pool-notify';

const PETALS = [{ mp4: '/motion/v2/petals.mp4', webm: '/motion/v2/petals.webm' }];
const PETALS_POSTER = '/motion/v2/petals.jpg';

/* The keys: the action pink one (the only object of its colour on screen),
 * and the cream one for the actions that move no money. */
const KEY = 'h-14 w-full border-[3px] border-brand-cream shadow-[var(--elevation-key-action)]';
const KEY_CREAM = 'h-14 w-full border-[3px] border-brand-berry';

type OptIn =
  | { state: 'idle' }
  | { state: 'prompt'; value: string; error: string | null }
  | { state: 'sending' }
  | { state: 'done'; email: string }
  | { state: 'failed' };

/** The pool line on the pass, or the wordmark when the page could not read the pool. */
function passPoolLine(poolNumber?: string | number): string {
  return poolNumber !== undefined ? COPY.reveal.passPool(poolNumber) : COPY.shell.title;
}

/** The line that is posted, and only that: the web intent takes text. */
export function openXWithLine(poolNumber?: string | number): void {
  const text = poolNumber !== undefined ? COPY.reveal.passShareText(poolNumber) : COPY.shell.tagline;
  window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
}

export function EnteredPanel({
  entryIndex,
  asset,
  poolNumber,
  mode,
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
  /** The rule this pool played; on the pass line beside the pool. */
  mode: BoardMode;
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
  const postOnX = useCallback(() => openXWithLine(poolNumber), [poolNumber]);

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
    <section aria-live="polite" className="animate-settle mx-auto flex w-full max-w-lg flex-col gap-4" data-testid="entered-panel">
      <Card tone="light" className="text-center" data-testid="pass-card">
        {/* The petals, where the trophy Blott stood — the clip's own 4:5 frame. */}
        <div className="relative aspect-[4/5] max-h-[56vh] w-full overflow-hidden bg-brand-berry">
          <AmbientClip tiers={PETALS} poster={PETALS_POSTER} className="absolute inset-0 h-full w-full object-cover" />
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-16 bg-[linear-gradient(180deg,transparent_0%,var(--color-brand-cream)_100%)]" />
        </div>
        <div className="px-5 pt-1 pb-7">
          <p className="font-mono text-[12px] tracking-[0.16em] uppercase text-brand-berry/70" data-testid="pass-line">
            {COPY.shell.title} · {passPoolLine(poolNumber)} · {mode === 'hard' ? COPY.board.modeHard : COPY.board.modeEasy}
          </p>
          <p className="mt-2 font-display text-[56px] leading-none font-extrabold text-brand-berry">{r.passEntered}</p>
          <p className="mt-3 text-[18px] font-semibold text-brand-berry">{r.cardSeat(entryIndex)}</p>
          <p className="mt-1 font-mono text-[11px] text-brand-berry/60">{truncateAddress(asset)}</p>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-display text-[28px] leading-8 font-extrabold text-ink">{r.sealedTitle}</h2>
        <p className="mt-2 text-[14px] leading-5 text-ink-muted">{COPY.pool.checkBack(Number(MIN_SEATS))}</p>
      </Card>

      <div className="flex flex-col gap-3">
        <Button size="lg" className={KEY} onClick={postOnX} data-testid="entered-post-x">
          <XMark size={18} />
          <span className="ml-2">{r.passShareX}</span>
        </Button>

        {notifyOffered && optIn.state === 'idle' ? (
          <Button size="lg" intent="cream" className={KEY_CREAM} onClick={keepUpdated} data-testid="keep-updated">
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
            <Button size="lg" type="submit" intent="cream" className={KEY_CREAM} data-testid="keep-updated-send">
              {COPY.notify.keepUpdatedSend}
            </Button>
          </form>
        ) : null}
        {notifyOffered && optIn.state === 'sending' ? (
          <p className="flex items-center justify-center gap-3 font-mono text-[12px] tracking-[0.14em] uppercase text-brand-berry">
            <span
              aria-hidden="true"
              className="inline-block h-3.5 w-3.5 animate-[rotate-once_1s_linear_infinite] rounded-full border-2 border-brand-berry border-t-transparent"
            />
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
            <Button intent="quiet" className="border-brand-berry/40 text-brand-berry" onClick={keepUpdated}>
              {COPY.notify.keepUpdated}
            </Button>
          </div>
        ) : null}

        {/* Founder 2026-09-27: "Play again" — the way onward is another pool. */}
        <Link
          href="/"
          data-testid="entered-play-again"
          className="flex h-14 w-full items-center justify-center rounded-full border-[3px] border-brand-berry/60 font-display text-[18px] font-bold uppercase tracking-wide text-brand-berry hover:bg-brand-berry/10"
        >
          {r.playAgain}
        </Link>
      </div>
    </section>
  );
}
