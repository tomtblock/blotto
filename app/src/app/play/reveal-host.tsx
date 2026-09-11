'use client';

/*
 * The reveal takeover host (C9) — the effectful shell around the PURE beat
 * machine (src/reveal/machine.ts). The machine owns every transition; this
 * component owns exactly the effects the machine's header assigns to it:
 *
 *   - the outcome promise → `tx_confirmed` / `tx_failed`;
 *   - taps → `tap`;
 *   - the per-beat timers (host-timing.ts): strain's stall timer, the
 *     fixed-duration tell/unseal advances → `stall_timeout` / `beat_elapsed`;
 *   - dismiss / retry buttons → `dismiss` / `retry`.
 *
 * CONFIRMED-BEFORE-REVEAL is the machine's own invariant (typed, pinned in
 * machine.test.ts) — nothing here can render a class early because the
 * visual projection carries no class field before the tell.
 *
 * Retry is offered ONLY when the failure says a fresh attempt is safe
 * (`TxFailure.retryable`, decided in tx/errors.ts): nothing landed and
 * nothing can still land. A landed entry must never see a "try again" — the
 * entry IS recorded and a second submit would enter twice, which PID §8.6
 * forbids. Until 2026-09-11 the key was `!broadcast`, which also withheld
 * the retry from a transaction the chain had definitively REFUSED (a stale
 * packet, a program error after broadcast) — audit O27.
 *
 * Leaving the takeover reports WHICH exit was taken (`RevealExit`, from the
 * machine's visual): the page behind renders "Sealed" only for `entered`.
 * Until 2026-09-11 every dismiss reported the same thing, and a player whose
 * transaction had failed pressed Back into "Your seven battles are sealed" —
 * audit O25.
 */

import { useEffect, useReducer, useState } from 'react';
import { COPY } from '@/copy';
import * as revealCopy from '@/reveal/copy';
import {
  INITIAL_REVEAL_STATE,
  revealReducer,
  revealVisual,
  type RevealEvent,
  type RevealExit,
  type RevealState,
} from '@/reveal/machine';
import { beatTimer } from '@/reveal/host-timing';
import { RevealStage, type RevealStageBeat } from '@/reveal/stages/reveal-stage';
import { classColorToken } from '@/reveal/class-colour';
import type { RevealResult } from '@/reveal/types';
import { truncateAddress } from '@/wallet/types';

const STAGE_BEATS: ReadonlySet<string> = new Set([
  'entry',
  'revealing',
  'strain',
  'failed',
  'tell',
  'unseal',
]);

export function RevealHost({
  result,
  onRetry,
  onDone,
}: {
  /** The entry's terminal state — resolves, never rejects (outcome.ts). */
  result: Promise<RevealResult>;
  /** Re-submit after a failure whose `retryable` is true (nothing landed,
   *  nothing can); absent = no retry offered. */
  onRetry?: () => Promise<RevealResult>;
  /** Called once when the player leaves the takeover, with the exit taken:
   *  `entered` (a seat is held), `not-entered` (nothing landed), or
   *  `pending` (broadcast, not yet confirmed — it may still land). */
  onDone: (exit: RevealExit) => void;
}) {
  const [state, dispatch] = useReducer(
    (s: RevealState, e: RevealEvent) => revealReducer(s, e),
    INITIAL_REVEAL_STATE
  );
  const [pending, setPending] = useState(result);

  // Outcome promise → machine events.
  useEffect(() => {
    let live = true;
    pending.then((r) => {
      if (!live) return;
      dispatch(
        r.kind === 'confirmed'
          ? { kind: 'tx_confirmed', outcome: r.outcome }
          : { kind: 'tx_failed', failure: r.failure }
      );
    });
    return () => {
      live = false;
    };
  }, [pending]);

  // Beat timers, armed from the pure schedule.
  const visual = revealVisual(state);
  const beat = visual.beat;
  const extended = visual.beat === 'tell' && visual.extended;
  useEffect(() => {
    const timer = beatTimer(revealVisual(state));
    if (!timer) return;
    const t = setTimeout(() => dispatch({ kind: timer.event }), timer.ms);
    return () => clearTimeout(t);
    // Re-arm on beat identity, not every state object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat, extended]);

  if (visual.beat === 'settled') {
    return <SettledExit exit={visual.exit} onDone={onDone} />;
  }

  if (visual.beat === 'stalled') {
    return (
      <section className="flex max-w-prose flex-col gap-4 p-6" aria-live="polite">
        <p className="text-sm opacity-80">{COPY.reveal.stalled}</p>
        <button type="button" className="underline" onClick={() => dispatch({ kind: 'dismiss' })}>
          {COPY.reveal.stalledDismiss}
        </button>
      </section>
    );
  }

  if (visual.beat === 'card') {
    return (
      <section className="flex max-w-prose flex-col items-center gap-4 p-6" aria-live="polite">
        <h2 className="text-lg">{COPY.reveal.cardTitle}</h2>
        <div
          className="rounded-lg border px-8 py-10 text-center"
          style={{ borderColor: `var(${classColorToken(visual.class)})` }}
        >
          <p className="font-mono text-[11px] tracking-[0.14em] uppercase opacity-70">
            {COPY.reveal.rarityNames[visual.class]} · {COPY.reveal.rarityOf(COPY.reveal.rarityCounts[visual.class])}
          </p>
          <p className="mt-1 text-2xl">{COPY.reveal.classNames[visual.class]}</p>
          <p className="mt-2 text-sm opacity-70">{COPY.reveal.cardSeat(visual.entryIndex)}</p>
          <p className="mt-1 font-mono text-xs opacity-50">{truncateAddress(visual.asset)}</p>
        </div>
        <p className="max-w-prose text-center text-[13px] leading-5 opacity-70">
          {revealCopy.EGG_NO_EFFECT}
        </p>
        <button
          type="button"
          className="rounded bg-brand px-6 py-2 text-(--color-base)"
          onClick={() => dispatch({ kind: 'dismiss' })}
        >
          {COPY.reveal.cardDone}
        </button>
      </section>
    );
  }

  // The stage-owned beats.
  return (
    <div className="flex flex-col items-center gap-4">
      {STAGE_BEATS.has(visual.beat) && (
        <RevealStage
          visual={visual as Parameters<typeof RevealStage>[0]['visual'] & { beat: RevealStageBeat }}
          onTap={() => dispatch({ kind: 'tap' })}
        />
      )}
      {(visual.beat === 'entry' || visual.beat === 'revealing' || visual.beat === 'strain') && (
        <EggGuide confirming={visual.beat === 'strain'} />
      )}
      {visual.beat === 'failed' && (
        <div className="flex max-w-prose flex-col gap-3 text-center" aria-live="polite">
          <p className="text-sm text-red-400">{visual.failure.message}</p>
          {onRetry && visual.failure.retryable && (
            <button
              type="button"
              className="rounded border px-6 py-2"
              onClick={() => {
                dispatch({ kind: 'retry' });
                setPending(onRetry());
              }}
            >
              {COPY.reveal.failedRetry}
            </button>
          )}
          <button type="button" className="underline" onClick={() => dispatch({ kind: 'dismiss' })}>
            {COPY.reveal.failedDismiss}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The words around the egg (founder 2026-09-09): what the tapping is, how
 * the rarity works, and that it changes nothing about the competition.
 * Class-NEUTRAL text — it names all five looks equally and never the one
 * this entry drew, which the machine has not revealed yet.
 */
function EggGuide({ confirming }: { confirming: boolean }) {
  return (
    <section
      className="animate-settle flex w-full max-w-md flex-col gap-3 px-2 text-center"
      data-testid="egg-guide"
      aria-live="polite"
    >
      <h2 className="font-display text-[22px] leading-7 font-bold text-ink">{revealCopy.EGG_TITLE}</h2>
      <p className="text-[14px] leading-6 text-ink-muted">
        {confirming ? revealCopy.EGG_CONFIRMING : revealCopy.EGG_WHAT}
      </p>
      <div className="rounded-2xl border border-line bg-raised px-4 py-3 text-left">
        <p className="font-mono text-[11px] tracking-[0.14em] text-ink-muted uppercase">
          {revealCopy.EGG_RARITY_TITLE}
        </p>
        <p className="mt-1 text-[13px] leading-5 text-ink">{revealCopy.EGG_RARITY}</p>
        <p className="mt-2 text-[13px] leading-5 text-ink-muted">{revealCopy.EGG_NO_EFFECT}</p>
      </div>
    </section>
  );
}

/** Settled is terminal: hand control back exactly once, after mount, saying
 *  which exit was taken. */
function SettledExit({ exit, onDone }: { exit: RevealExit; onDone: (exit: RevealExit) => void }) {
  useEffect(() => {
    onDone(exit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
