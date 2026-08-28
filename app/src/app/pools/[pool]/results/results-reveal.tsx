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
import { buttonClasses } from '@/components/ui/button';
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

/* 6.6: rows cascade with a 30ms stagger, capped so late rows appear
 * instantly rather than queueing behind a long list. */
const ROW_STAGGER_MS = 30;
const STAGGER_CAP_MS = 480;

export function ResultsReveal({ rows }: { rows: RevealRow[] }) {
  const auth = useAuth();
  const wallet = auth.status === 'signed-in' ? auth.walletAddress : null;
  // The stagger is pure CSS: `enter … both` holds each row invisible until
  // its animation-delay passes, so no mount gate or effect is needed.

  return (
    <ol className="flex flex-col">
      {rows.map((r, i) => {
        const mine = wallet !== null && r.player === wallet;
        const paid = r.amountSol !== null;
        return (
          <li
            key={r.seat}
            className={
              'animate-enter relative flex items-center gap-4 overflow-hidden px-4 py-2.5 ' +
              (i > 0 ? 'border-t border-line ' : '') +
              // Paid rows carry the accent warmth; your row a touch more.
              (mine ? 'rounded-lg bg-prize/10' : paid ? 'bg-brand/[0.04]' : '')
            }
            style={{ animationDelay: `${Math.min(i * ROW_STAGGER_MS, STAGGER_CAP_MS)}ms` }}
          >
            {/* One gentle LIGHT sweep across your row, once the cascade
                has settled it — never repeated. */}
            {mine ? (
              <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
                <span
                  className="animate-light-pass absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-prize/15 to-transparent"
                  style={{ animationDelay: `${Math.min(i * ROW_STAGGER_MS, STAGGER_CAP_MS) + 350}ms` }}
                />
              </span>
            ) : null}
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
                  held for review
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
    <Link href={`/verify?pool=${pool}`} className={buttonClasses('secondary', 'md') + ' w-full'}>
      {COPY.verify.title}
    </Link>
  );
}
