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
 * WHAT IT DRAWS (V2, founder 2026-09-27). The waiting beat is whatever the
 * page hands in as `waiting` — the signing hold over the board's record
 * (signing-overlay.tsx). The card beat is `renderCard` — the success screen
 * (entered-panel.tsx), terminal: no Continue, no dismiss. A failure is the
 * site's one stop card, with Try again only when the failure says a fresh
 * attempt is safe. The page-layout pass card and the reveal scene this host
 * once drew are gone.
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
 * machine's visual): `not-entered` restarts the flow, `pending` goes to the
 * pool page. Until 2026-09-11 every dismiss reported the same thing, and a
 * player whose transaction had failed pressed Back into "Your seven battles
 * are sealed" — audit O25.
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
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { STOP_ACTIONS, StopCard, type StopAction } from '@/components/ui/stop-card';

export function RevealHost({
  result,
  onRetry,
  onDone,
  onBeat,
  waiting,
  renderCard,
}: {
  /** Each beat, once, to whoever draws the page behind this host. */
  onBeat?: (beat: RevealState['beat']) => void;
  /** What the waiting beat shows — the signing hold, drawn over the page. */
  waiting: ReactNode;
  /** The confirmed entry: the success screen. Terminal — its links are the exits. */
  renderCard: (card: { entryIndex: number; asset: string }) => ReactNode;
  /** The entry's terminal state — resolves, never rejects (outcome.ts). */
  result: Promise<RevealResult>;
  /** Re-submit after a failure whose `retryable` is true (nothing landed,
   *  nothing can); absent = no retry offered. */
  onRetry?: () => Promise<RevealResult>;
  /** Called once when the player leaves the takeover, with the exit taken:
   *  `not-entered` (nothing landed) or `pending` (broadcast, not yet
   *  confirmed — it may still land). `entered` is no longer reachable: the
   *  success screen has no dismiss. */
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

  // Report each beat once to whoever draws the page behind this host.
  useEffect(() => {
    onBeat?.(state.beat);
  }, [state.beat, onBeat]);

  if (visual.beat === 'settled') {
    return <SettledExit exit={visual.exit} onDone={onDone} />;
  }

  if (visual.beat === 'entry') {
    // Waiting for the chain. Nothing to tap; the stall timer above is what
    // keeps this from being a dead end.
    return <>{waiting}</>;
  }

  if (visual.beat === 'stalled') {
    // A genuine stall, never a failure: the entry is submitted and may still
    // land, so the way out is the pool page, which shows it when it does.
    return (
      <Card className="animate-rise flex flex-col gap-4 p-6" aria-live="polite" data-testid="entry-stalled">
        <h2 className="font-display text-[26px] leading-[30px] font-extrabold text-ink">{COPY.reveal.stalledTitle}</h2>
        <p className="max-w-prose text-[15px] leading-6 text-ink-muted">{COPY.reveal.stalled}</p>
        <Button intent="quiet" className="self-start" onClick={() => dispatch({ kind: 'dismiss' })}>
          {COPY.reveal.stalledDismiss}
        </Button>
      </Card>
    );
  }

  if (visual.beat === 'card') {
    return <>{renderCard({ entryIndex: visual.entryIndex, asset: visual.asset })}</>;
  }

  // failed — the rejection card (founder 2026-09-27): the site's stop card,
  // with the ways out that fit the failure. Try again only when safe; Add
  // SOL when the wallet could not cover it; Find another pool always.
  const retryable = Boolean(onRetry) && visual.failure.retryable;
  const actions: StopAction[] = [];
  if (onRetry && retryable) {
    actions.push({
      label: COPY.stop.tryAgain,
      intent: 'primary',
      'data-testid': 'entry-retry',
      onClick: () => {
        dispatch({ kind: 'retry' });
        setPending(onRetry());
      },
    });
  }
  if (visual.failure.kind === 'insufficient-sol') {
    actions.push({ href: '/wallet', label: COPY.gate.topUp, intent: retryable ? 'quiet' : 'primary' });
  }
  actions.push({ ...STOP_ACTIONS.findAnotherPool(), intent: actions.some((a) => a.intent === 'primary') ? 'quiet' : 'primary' });
  actions.push({ label: COPY.stop.backToPool, intent: 'quiet', onClick: () => dispatch({ kind: 'dismiss' }) });
  return (
    <StopCard kind="failure" title={COPY.stop.entryFailedTitle} actions={actions} data-testid="stop-entry-failed">
      <p>{visual.failure.message}</p>
    </StopCard>
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
