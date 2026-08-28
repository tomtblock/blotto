'use client';

/*
 * The what-finished-above-you panel (v3 D3): after the reveal, decrypt the
 * pool's sealed battles in the browser with the on-chain secret and show
 * how each better-committed seat played you, battle by battle. Anonymised
 * by seat; the recomputation is the same engine as the crank (R20) via
 * src/results/what-beat-you.ts. Win/loss cells wear priceUp/priceDown —
 * their one sanctioned semantics.
 */

import { useEffect, useState } from 'react';
import { COPY } from '@/copy';
import { indexerApi } from '@/data/api';
import { lamportsToSol } from '@/data/format';
import type { ResultRow } from '@/data/types';
import { useAuth } from '@/wallet/auth-context';
import { Card } from '@/components/ui/card';
import { decryptSeatBattles, whatFinishedAbove, type AboveYouRow } from '@/results/what-beat-you';

const SHOWN = 8;

export interface WhatBeatYouPanelProps {
  pool: string;
  /** The revealed pool secret (hex) — null before reveal. */
  secretHex: string | null;
  results: ResultRow[];
  /** seat → player wallet (for finding YOUR seat only; never rendered). */
  seatByPlayer: Record<string, number>;
}

const OUTCOME_CLASS = {
  win: 'bg-price-up',
  draw: 'bg-ink-muted',
  loss: 'bg-price-down',
} as const;

export function WhatBeatYouPanel({ pool, secretHex, results, seatByPlayer }: WhatBeatYouPanelProps) {
  const auth = useAuth();
  const wallet = auth.status === 'signed-in' ? auth.walletAddress : null;
  const mySeat = wallet !== null && wallet in seatByPlayer ? seatByPlayer[wallet] : null;
  const [rows, setRows] = useState<AboveYouRow[] | null>(null);

  useEffect(() => {
    if (mySeat === null || secretHex === null) return;
    let cancelled = false;
    indexerApi()
      .getSealedEntries(pool)
      .then((sealedRows) => {
        if (cancelled) return;
        const battles = decryptSeatBattles(secretHex, sealedRows);
        setRows(whatFinishedAbove(mySeat, results, battles));
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pool, secretHex, mySeat, results]);

  // Not signed in, not entered, or pre-reveal: this panel simply is not for
  // this viewer — nothing renders.
  if (mySeat === null || secretHex === null || rows === null) return null;
  if (rows.length === 0) return null;

  return (
    <Card className="mb-5 p-5">
      <h2 className="mb-1 font-display text-[18px] font-bold text-ink">{COPY.beatYou.title}</h2>
      <p className="mb-4 max-w-prose text-[12px] leading-4 text-ink-muted">{COPY.beatYou.note}</p>
      <ol className="flex flex-col gap-3">
        {rows.slice(0, SHOWN).map((r) => (
          <li key={r.seat} className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="tnum w-10 text-[12px] uppercase tracking-[0.1em] text-ink-muted">
              s{r.seat}
            </span>
            <span className="tnum font-display text-[15px] font-semibold text-ink">
              {lamportsToSol(r.amountLamports)}
              <span className="ml-1 font-body text-[11px] font-medium text-ink-muted">SOL</span>
            </span>
            <span className="text-[13px] text-ink-muted">
              {COPY.beatYou.headToHead(r.wins, r.draws, r.losses)}
            </span>
            <span className="ml-auto flex gap-1" aria-hidden>
              {r.comparisons.map((c, k) => (
                <span
                  key={k}
                  title={`Battle ${k + 1}: ${r.battles[k].join('·')}`}
                  className={`h-2.5 w-2.5 rounded-full ${OUTCOME_CLASS[c.outcome]}`}
                />
              ))}
            </span>
          </li>
        ))}
      </ol>
      {rows.length > SHOWN && (
        <p className="mt-3 text-[12px] text-ink-muted">
          and {rows.length - SHOWN} more — the Verify page recomputes the full field.
        </p>
      )}
    </Card>
  );
}
