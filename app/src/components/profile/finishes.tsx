'use client';

/*
 * Previous finishes (V3, founder 2026-09-27: the profile is one dashboard,
 * with a table of previous finishes in the notifications sheet's style —
 * Pool, Position, Date, the way to the results — and a pool opens a card
 * showing how the player played it).
 *
 * SOURCES. The rows are the career read (every pool this wallet entered,
 * newest first); the date is the day the pool closed to entries (its fill
 * deadline, from the pools list); the position is the verified archive's
 * rank where there is one, else the state says what is happening — the
 * same rules the bell uses (components/shell/notifications.tsx).
 *
 * THE MATRIX. A pool's card reads the player's own seven battles from the
 * pool's published bundle — the file at the verified archive's permanent
 * URI, each seat checked against its committed hash
 * (results/what-beat-you.ts) — and shows the 7 × 5 grid. Nothing renders
 * before the pool is published: an open or sealed pool says so. SEALING is
 * untouched — this reads only what the reveal has already published.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { BattleSet } from '@blotto/scoring';
import { STAT_NAMES } from '@/battle/allocation';
import { COPY } from '@/copy';
import { indexerApi } from '@/data/api';
import { formatDay } from '@/data/format';
import type { CareerRow } from '@/data/types';
import type { PublishedBundle } from '@/verify/logic';
import { battlesFromBundle } from '@/results/what-beat-you';
import { positionLabel, wonSolOf } from '@/components/shell/notifications';
import { Modal } from '@/components/ui/modal';

const ABBR = ['STR', 'SPD', 'HRT', 'WIT', 'DUR'] as const;

export interface FinishRow {
  pool: string;
  poolId: string;
  seat: number | null;
  position: string;
  /** The day the pool closed to entries, or ''. */
  day: string;
  /** A Paid pool that paid this wallet. */
  won: boolean;
  /** Results-page states link there; others to the pool page. */
  toResults: boolean;
}

/** The table's rows from the career read, newest first. Pure. */
export function finishRows(career: readonly CareerRow[], closedByPool: ReadonlyMap<string, string>): FinishRow[] {
  return [...career]
    .reverse()
    .flatMap((row) => {
      if (row.pool_id === null) return [];
      const wonSol = wonSolOf(row);
      const state = row.state ?? 'Open';
      return [
        {
          pool: row.pool,
          poolId: row.pool_id,
          seat: row.seat,
          position: positionLabel({ state, rank: typeof row.rank === 'number' ? row.rank : null, wonSol }),
          day: formatDay(closedByPool.get(row.pool) ?? null),
          won: wonSol !== null,
          toResults: state === 'Scored' || state === 'Paid',
        },
      ];
    });
}

type Matrix =
  | { state: 'loading' }
  | { state: 'unpublished' }
  | { state: 'missing' }
  | { state: 'failed' }
  | { state: 'ready'; battles: BattleSet };

/** The pool's card: the player's own 7 × 5, from the published bundle. */
function PoolMatrix({ row }: { row: FinishRow }) {
  const f = COPY.profile.finishes;
  const [matrix, setMatrix] = useState<Matrix>({ state: 'loading' });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const archive = await indexerApi().getLeaderboard(row.pool);
        if (!archive) {
          if (!cancelled) setMatrix({ state: 'unpublished' });
          return;
        }
        const res = await fetch(archive.uri, { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const published = (await res.json()) as PublishedBundle;
        const mine = row.seat === null ? undefined : battlesFromBundle(published).get(row.seat);
        if (!cancelled) setMatrix(mine ? { state: 'ready', battles: mine } : { state: 'missing' });
      } catch {
        if (!cancelled) setMatrix({ state: 'failed' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [row.pool, row.seat]);

  const total = matrix.state === 'ready' ? matrix.battles.reduce((a, b) => a + b.reduce((x, y) => x + y, 0), 0) : 0;
  return (
    <div className="flex flex-col gap-4" data-testid="finish-matrix" data-state={matrix.state}>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-brand-berry/70">{COPY.notify.colPosition}</p>
          <p className={`tnum font-display text-[36px] leading-none font-extrabold ${row.won ? 'text-brand-deep-magenta' : 'text-brand-berry'}`}>{row.position}</p>
        </div>
        {row.day ? (
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-brand-berry/70">{COPY.notify.colDate}</p>
            <p className="tnum font-display text-[22px] leading-none font-bold text-brand-berry">{row.day}</p>
          </div>
        ) : null}
      </div>

      {matrix.state === 'loading' ? (
        <p aria-live="polite" className="text-[14px] text-brand-berry/80">
          {f.matrixLoading}
        </p>
      ) : null}
      {matrix.state === 'unpublished' ? <p className="max-w-prose text-[14px] leading-5 text-brand-berry/80">{f.matrixUnpublished}</p> : null}
      {matrix.state === 'missing' ? <p className="max-w-prose text-[14px] leading-5 text-brand-berry/80">{f.matrixMissing}</p> : null}
      {matrix.state === 'failed' ? <p className="max-w-prose text-[14px] leading-5 text-brand-berry/80">{f.matrixFailed}</p> : null}
      {matrix.state === 'ready' ? (
        <div className="overflow-x-auto rounded-2xl border border-brand-berry/15 bg-brand-berry/5">
          <table className="w-full min-w-[330px] border-collapse text-[14px]" aria-label={f.matrixAria(row.poolId)}>
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-brand-berry/70">
                <th className="px-3 py-2 font-medium">{COPY.board.reviewBattle}</th>
                {ABBR.map((a, z) => (
                  <th key={a} scope="col" abbr={STAT_NAMES[z]} title={STAT_NAMES[z]} className="px-2 py-2 text-right font-medium">
                    {a}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium">Σ</th>
              </tr>
            </thead>
            <tbody>
              {matrix.battles.map((b, k) => (
                <tr key={k} className="border-t border-brand-berry/15">
                  <td className="px-3 py-2 font-medium text-brand-berry">{COPY.board.field(k + 1)}</td>
                  {b.map((v, z) => (
                    <td key={z} className="tnum px-2 py-2 text-right font-mono text-brand-berry">
                      {v}
                    </td>
                  ))}
                  <td className="tnum px-3 py-2 text-right font-mono font-semibold text-brand-berry">{b.reduce((x, y) => x + y, 0)}</td>
                </tr>
              ))}
              <tr className="border-t border-brand-berry/25">
                <td className="px-3 py-2 font-medium text-brand-berry" colSpan={6}>
                  {COPY.board.reviewTotal}
                </td>
                <td className="tnum px-3 py-2 text-right font-mono font-semibold text-brand-berry">{total}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}

      <Link
        href={row.toResults ? `/pools/${row.pool}/results` : `/pools/${row.pool}`}
        className="key-prize flex h-12 items-center justify-center self-start rounded-full bg-brand-yellow px-6 font-display text-[15px] font-bold uppercase tracking-wide text-brand-berry hover:bg-brand-cream"
      >
        {row.toResults ? COPY.notify.viewResults : COPY.notify.viewPool}
      </Link>
    </div>
  );
}

export function Finishes({ rows }: { rows: FinishRow[] }) {
  const f = COPY.profile.finishes;
  const [openPool, setOpenPool] = useState<string | null>(null);
  const open = useMemo(() => rows.find((r) => r.pool === openPool) ?? null, [rows, openPool]);

  if (rows.length === 0) {
    return <p className="text-[15px] leading-6 text-ink-muted">{f.empty}</p>;
  }
  return (
    <>
      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
        <table className="w-full min-w-[420px] border-collapse text-[14px]" aria-label={f.tableAria}>
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-ink-muted">
              <th className="px-3 py-2 font-medium">{COPY.notify.colPool}</th>
              <th className="px-3 py-2 font-medium">{COPY.notify.colPosition}</th>
              <th className="px-3 py-2 font-medium">{COPY.notify.colDate}</th>
              <th className="px-3 py-2 font-medium">
                <span className="sr-only">{COPY.notify.viewResults}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pool} data-testid="finish-row" className={'border-t border-line ' + (r.won ? 'font-semibold text-prize' : 'text-ink')}>
                <td className="px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => setOpenPool(r.pool)}
                    className="tnum underline underline-offset-2 hover:text-brand"
                    aria-label={f.openAria(r.poolId)}
                    data-testid="finish-open"
                  >
                    {COPY.reveal.passPool(r.poolId)}
                  </button>
                </td>
                <td className="tnum px-3 py-2.5">{r.position}</td>
                <td className="tnum px-3 py-2.5 whitespace-nowrap text-ink-muted">{r.day || COPY.notify.positionPending}</td>
                <td className="px-3 py-2.5 text-right">
                  <Link
                    href={r.toResults ? `/pools/${r.pool}/results` : `/pools/${r.pool}`}
                    className={'whitespace-nowrap underline underline-offset-2 ' + (r.won ? 'text-prize' : 'text-ink hover:text-brand')}
                  >
                    {r.toResults ? COPY.notify.viewResults : COPY.notify.viewPool}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={open !== null} onClose={() => setOpenPool(null)} title={open ? COPY.reveal.passPool(open.poolId) : ''} kicker={f.matrixKicker} data-testid="finish-modal">
        {open ? <PoolMatrix key={open.pool} row={open} /> : null}
      </Modal>
    </>
  );
}
