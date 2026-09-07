'use client';

/*
 * The results reveal (v3 D2 moment 5): the committed payout list staged as a
 * live event rather than dumped as a table — the header settles, rows sweep
 * in top prize first, and the signed-in player's row lights in prize amber
 * once the field is on screen. Reduced motion collapses the staging to an
 * instant render (global tokens.css rule).
 *
 * PHASE-D2-REVIEW: v3 asks for "battles → rank → prize table". Battle
 * allocations and rank labels live in the PUBLISHED BUNDLE (D3-B), not the
 * indexer; this page stages what the indexer serves (the committed amounts,
 * seat-keyed) and always links Verify, where the bundle-backed recomputation
 * lives. The bundle-fed battle stage lands with D3's "what beat you" work.
 *
 * Data discipline: every amount is a preformatted SOL string computed
 * upstream; this component does no arithmetic and invents no ranks.
 */

import Link from 'next/link';
import { COPY } from '@/copy';
import { useAuth } from '@/wallet/auth-context';

export interface RevealRow {
  seat: number;
  /** Truncated player address for display. */
  playerShort: string;
  /** Full player address (highlight matching). */
  player: string;
  /** Preformatted SOL amount, or null when the share is held for review. */
  amountSol: string | null;
}

const ROW_STAGGER_MS = 90;

export function ResultsReveal({ rows }: { rows: RevealRow[] }) {
  const auth = useAuth();
  const wallet = auth.status === 'signed-in' ? auth.walletAddress : null;
  // The stagger is pure CSS: `reveal … both` holds each row invisible until
  // its animation-delay passes, so no mount gate or effect is needed.

  return (
    <ol className="flex flex-col">
      {rows.map((r, i) => {
        const mine = wallet !== null && r.player === wallet;
        return (
          <li
            key={r.seat}
            className={
              'animate-reveal flex items-center gap-4 px-4 py-2.5 ' +
              (i > 0 ? 'border-t border-line ' : '') +
              (mine ? 'rounded-lg bg-prize/10' : '')
            }
            style={{ animationDelay: `${i * ROW_STAGGER_MS}ms` }}
          >
            <span className="tnum w-10 text-[12px] uppercase tracking-[0.1em] text-ink-muted">
              s{r.seat}
            </span>
            <span
              className={
                'font-mono text-[13px] ' + (mine ? 'font-semibold text-ink' : 'text-ink-muted')
              }
            >
              {mine ? 'You' : r.playerShort}
            </span>
            <span
              className={
                'tnum ml-auto font-display text-[18px] font-bold ' +
                (mine ? 'text-prize' : r.amountSol ? 'text-ink' : 'text-ink-muted')
              }
            >
              {r.amountSol !== null ? (
                <>
                  {r.amountSol}
                  <span className="ml-1 font-body text-[11px] font-medium text-ink-muted">SOL</span>
                </>
              ) : (
                <span title={COPY.results.escrowHeld} className="text-[13px] font-medium">
                  {COPY.results.heldForReview}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The verify affordance — always on screen with the results (R20/D3-B). */
export function VerifyAlways({ pool }: { pool: string }) {
  return (
    <Link
      href={`/verify?pool=${pool}`}
      className="flex h-12 items-center justify-center rounded-xl border border-line text-[15px] font-medium text-ink transition-colors hover:border-brand hover:text-brand"
    >
      {COPY.verify.title}
    </Link>
  );
}
