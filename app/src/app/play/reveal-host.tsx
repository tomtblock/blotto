'use client';

/*
 * The entry takeover host (C9) — the effectful shell around the PURE beat
 * machine (src/reveal/machine.ts). The machine owns every transition; this
 * component owns exactly the effects the machine's header assigns to it:
 *
 *   - the outcome promise → `tx_confirmed` / `tx_failed`;
 *   - the waiting beat's stall timer (host-timing.ts) → `stall_timeout`;
 *   - dismiss / retry buttons → `dismiss` / `retry`.
 *
 * WHAT CHANGED 2026-09-15. Until then this host also rendered the reveal —
 * the egg, the tapping, the class tell and unseal — from a stage component
 * that read the drawn class off the machine's projection. The founder's
 * instruction of 2026-09-14 removed the reveal: between the signature and
 * the chain's answer the player now sees a quiet waiting hold, and the
 * card that follows carries no class. The projection no longer has one to
 * give (machine.ts, `RevealVisual`), so this file cannot show it even by
 * accident.
 *
 * CONFIRMED-BEFORE-CARD is the machine's own invariant (typed, pinned in
 * machine.test.ts) — nothing here can render the card early because the
 * visual projection carries no outcome before `tx_confirmed`.
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

import { useEffect, useReducer, useState, type ReactNode } from 'react';
import { COPY } from '@/copy';
import {
  INITIAL_REVEAL_STATE,
  revealReducer,
  revealVisual,
  type RevealEvent,
  type RevealExit,
  type RevealState,
} from '@/reveal/machine';
import { beatTimer } from '@/reveal/host-timing';
import type { RevealResult } from '@/reveal/types';
import { PendingPanel } from '@/components/ui/pending-panel';
import { PassCard } from './pass-card';

export function RevealHost({
  result,
  onRetry,
  onDone,
  poolNumber,
  onBeat,
  quiet = false,
  renderCard,
}: {
  /** Founder 2026-09-16: the seal stage follows the beats (card → done, failed → stopped). */
  onBeat?: (beat: RevealState['beat']) => void;
  /**
   * Round four (2026-09-17): the host that draws the scene also draws the
   * confirmed entry — the pass, the sealed note, the actions — in its own
   * column (entered-panel.tsx). Given, the card beat renders this instead of
   * the page-layout PassCard, and there is no Continue: the column is the
   * end of the flow, its links the exits.
   */
  renderCard?: (card: { entryIndex: number; asset: string }) => ReactNode;
  /** The page shows the wait itself (the blender); the entry beat renders nothing. */
  quiet?: boolean;
  /** The entry's terminal state — resolves, never rejects (outcome.ts). */
  result: Promise<RevealResult>;
  /** The pool's number, for the pass card (2026-09-13). Optional: the card
   *  omits it rather than guess. */
  poolNumber?: string | number;
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

  // The stall timer, armed from the pure schedule.
  const visual = revealVisual(state);
  const beat = visual.beat;
  useEffect(() => {
    const timer = beatTimer(revealVisual(state));
    if (!timer) return;
    const t = setTimeout(() => dispatch({ kind: timer.event }), timer.ms);
    return () => clearTimeout(t);
    // Re-arm on beat identity, not every state object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat]);

  // Report each beat once to whoever draws the scene behind this host.
  useEffect(() => {
    onBeat?.(state.beat);
  }, [state.beat, onBeat]);

  if (visual.beat === 'settled') {
    return <SettledExit exit={visual.exit} onDone={onDone} />;
  }

  if (visual.beat === 'entry') {
    // Waiting for the chain. Nothing to tap, nothing to reveal; the stall
    // timer above is what keeps this from being a dead end.
    if (quiet) return null;
    return <PendingPanel label={COPY.reveal.confirming} />;
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
    if (renderCard) return <>{renderCard({ entryIndex: visual.entryIndex, asset: visual.asset })}</>;
    // The pass, and — now that the entry is CONFIRMED — the share
    // (2026-09-13; see pass-card.tsx for what it may show and why).
    return (
      <div className="flex flex-col items-center p-2">
        <PassCard
          entryIndex={visual.entryIndex}
          asset={visual.asset}
          poolNumber={poolNumber}
          onDone={() => dispatch({ kind: 'dismiss' })}
        />
      </div>
    );
  }

  // failed
  return (
    <div className="flex flex-col items-center gap-4">
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
    </div>
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
