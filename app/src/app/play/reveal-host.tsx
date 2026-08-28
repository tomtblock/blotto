'use client';

/*
 * The entry-outcome host (C9; rebuilt per UI constitution 6.5/6.6): the
 * calm shell around the entry's terminal promise. The predecessor's
 * tap-to-crack reveal theatre is gone — the entry moment is now:
 *
 *   sealing — the seven sealed battles TRAVEL into the pool glyph while
 *             the transaction runs; a quiet hold, tap-free.
 *   sealed  — the persona-defining confirmation: "Sealed", the 80/20
 *             entry split playing over labeled endpoints, the LIVE ring
 *             (whose LIGHT pass fires when the poll sees the real entry
 *             on-chain — never before), and then the character pass as a
 *             quiet card that fades and settles. Rank-before-rarity
 *             discipline: the pass is presented after the consequential
 *             information, never as the moment.
 *   stalled — the honest long-confirmation message (the entry is
 *             submitted; nothing further is needed).
 *   failed  — failure as data, in place, next to the fix. Retry is
 *             offered ONLY for a never-broadcast failure (a landed entry
 *             must never see "try again" — a second submit would enter
 *             twice, which PID §8.6 forbids).
 *
 * The stall timer is the one piece of pacing kept from the old machine
 * (STALL_THRESHOLD_MS); a confirmation that lands while stalled still
 * resolves to sealed — stalled is a message, not a terminal state.
 */

import { useEffect, useState } from 'react';
import { COPY } from '@/copy';
import { Button, buttonClasses } from '@/components/ui/button';
import { ErrorSurface } from '@/components/ui/error-surface';
import { EntrySplit } from '@/components/entry-split';
import { LivePoolRing } from '@/components/pool/live-pool-ring';
import { Frost } from '@/components/ui/frost';
import { PentagonMini } from '@/components/ui/pentagon-mini';
import { PassCard } from '@/reveal/components/pass-card';
import { STALL_THRESHOLD_MS } from '@/reveal/constants';
import type { RevealOutcome, RevealResult } from '@/reveal/types';
import type { TxFailure } from '@/tx/types';
import type { Allocation } from '@/battle/allocation';
import type { PoolSummary } from '@/data/types';
import { usePrefersReducedMotion } from '@/design/use-reduced-motion';

type HostPhase =
  | { kind: 'sealing'; stalled: boolean }
  | { kind: 'sealed'; outcome: RevealOutcome }
  | { kind: 'failed'; failure: TxFailure };

export function RevealHost({
  result,
  pool,
  battles,
  onRetry,
  onDone,
}: {
  /** The entry's terminal state — resolves, never rejects (outcome.ts). */
  result: Promise<RevealResult>;
  /** The pool being entered — powers the split amounts and the live ring. */
  pool: PoolSummary;
  /** The just-sealed battles, for the TRAVEL-to-pool visual. */
  battles: readonly Allocation[] | null;
  /** Re-submit after a NEVER-BROADCAST failure; absent = no retry offered. */
  onRetry?: () => Promise<RevealResult>;
  /** Called when the player dismisses the settled confirmation. */
  onDone: () => void;
}) {
  const [pending, setPending] = useState(result);
  const [phase, setPhase] = useState<HostPhase>({ kind: 'sealing', stalled: false });
  const reduced = usePrefersReducedMotion();

  // Outcome promise → phase.
  useEffect(() => {
    let live = true;
    pending.then((r) => {
      if (!live) return;
      setPhase(
        r.kind === 'confirmed'
          ? { kind: 'sealed', outcome: r.outcome }
          : { kind: 'failed', failure: r.failure }
      );
    });
    return () => {
      live = false;
    };
  }, [pending]);

  // The stall message, honest and single-shot per pending promise.
  useEffect(() => {
    const t = setTimeout(
      () => setPhase((p) => (p.kind === 'sealing' ? { kind: 'sealing', stalled: true } : p)),
      STALL_THRESHOLD_MS
    );
    return () => clearTimeout(t);
  }, [pending]);

  if (phase.kind === 'sealed') {
    return (
      <section aria-live="polite" className="animate-enter flex flex-col items-center gap-5 py-8 text-center">
        <h2 className="font-display text-[34px] leading-[38px] font-extrabold text-ink">Sealed</h2>
        <p className="max-w-prose text-[15px] leading-6 text-ink-muted">{COPY.pool.sealed}</p>
        {/* The player watches their money go exactly where the
            documentation says it goes. */}
        <EntrySplit entryLamports={pool.entry_lamports} playOnMount className="max-w-[420px]" />
        <LivePoolRing pool={pool} size={96} riser />
        <PassCard outcome={phase.outcome} />
        <Button size="lg" onClick={onDone}>
          {COPY.reveal.cardDone}
        </Button>
      </section>
    );
  }

  if (phase.kind === 'failed') {
    return (
      <section className="flex flex-col items-center gap-4 py-10" aria-live="polite">
        <ErrorSurface className="max-w-prose">{phase.failure.message}</ErrorSurface>
        <div className="flex gap-3">
          {onRetry && !phase.failure.broadcast ? (
            <Button
              onClick={() => {
                setPhase({ kind: 'sealing', stalled: false });
                setPending(onRetry());
              }}
            >
              {COPY.reveal.failedRetry}
            </Button>
          ) : null}
          <a href={`/pools/${pool.pool}`} className={buttonClasses('secondary', 'md')}>
            {COPY.reveal.failedDismiss}
          </a>
        </div>
      </section>
    );
  }

  // Sealing: the seven sealed battles TRAVEL into the pool glyph, then a
  // quiet hold. Pleasant to watch, pleasant to ignore.
  return (
    <section aria-live="polite" className="flex flex-col items-center gap-6 py-14">
      <div
        className="relative flex h-40 w-full max-w-[360px] items-end justify-center"
        aria-hidden
      >
        <div
          className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-brand"
          style={{ boxShadow: 'var(--glow-action)' }}
        >
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-brand">
            <circle
              cx="12"
              cy="12"
              r="8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeDasharray="2.4 1.8"
            />
          </svg>
        </div>
        {!reduced && battles
          ? battles.map((b, k) => (
              <div
                key={k}
                className="to-pool absolute top-0"
                style={
                  {
                    left: `${6 + k * 13}%`,
                    '--tx': `${(50 - (6 + k * 13)) * 3.4}px`,
                    '--ty': '96px',
                    animationDelay: `${k * 40}ms`,
                  } as React.CSSProperties
                }
              >
                <Frost frosted>
                  <PentagonMini allocation={b} size={34} />
                </Frost>
              </div>
            ))
          : null}
      </div>
      <div
        className="h-8 w-8 rounded-full border-2 border-overlay border-t-brand motion-safe:animate-rotate"
        aria-hidden
      />
      <p className="text-[15px] text-ink-muted">
        {phase.stalled ? COPY.reveal.stalled : COPY.battle.sealing}
      </p>
      {phase.stalled ? (
        <a href={`/pools/${pool.pool}`} className={buttonClasses('secondary', 'md')}>
          {COPY.reveal.stalledDismiss}
        </a>
      ) : null}
    </section>
  );
}
