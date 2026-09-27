'use client';

/*
 * In-app notifications (v3 D3): a bell in the header, a sheet of FACTUAL
 * state changes for pools this wallet entered — sealed, results committed,
 * prizes paid, refunds open. Derived client-side from the read API (career
 * rows × pool state); "seen" is a per-device localStorage set, so the badge
 * is a convenience, never a server-side signal.
 *
 * THE EMAIL TOGGLE WAS REMOVED (D-E11, founder ruling 2026-09-13). It
 * recorded a wallet-signed opt-in with the entry service for a delivery
 * nothing in this repository can perform: there is no mail code and no
 * provider account. The ruling is to cut the promise now and build the
 * dispatcher later; `POST /notify` and its store stay in place and dormant,
 * and consents already given stay recorded. What remains here — the bell and
 * the sheet — is delivery we actually perform, to an open tab. (The per-pool
 * opt-in with an address is the success screen's, 2026-09-17 — entered-panel.)
 *
 * V2 (founder 2026-09-27, sketch G): the sheet is the notify clip over a
 * TABLE — Pool, Position, Date, the way to the results. A win is gold. A row
 * is "New" until its results have been opened from here on this device (the
 * old rule marked everything seen the moment the sheet opened). The
 * Congratulations box and its confetti are gone; the toast for a state that
 * arrives while the tab is open stays.
 *
 * Nothing here asks twice, counts anything down, or prompts re-entry —
 * retention is mastery and standing (D-UI-2), and the do-not-build
 * vocabulary is CI-enforced.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { COPY } from '@/copy';
import { indexerApi } from '@/data/api';
import { formatDay, lamportsToSol } from '@/data/format';
import type { CareerRow } from '@/data/types';
import { useAuth } from '@/wallet/auth-context';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { AmbientClip } from '@/components/ui/ambient-clip';
import { migrateLegacyKey, opaqueKey, opaqueToken } from '@/storage/opaque-key';

export interface NotifyItem {
  key: string;
  poolId: string;
  pool: string;
  state: NonNullable<CareerRow['state']>;
  /** The toast line for a state that arrives while the tab is open. */
  message: string;
  /** Results-page states link there; others to the pool page. */
  toResults: boolean;
  /** The prize this wallet was paid in this pool, in SOL — a win. */
  wonSol: string | null;
  /** The verified archive's rank, when the career row carries one (E3). */
  rank: number | null;
  /** The day the pool closed to entries (its fill deadline), unix seconds. */
  closedUnix: string | null;
}

/** How often an open tab re-reads the player's pools for a new state. */
const POLL_MS = 60_000;

const CLIP = [{ mp4: '/motion/v2/notify.mp4', webm: '/motion/v2/notify.webm' }];
const POSTER = '/motion/v2/notify.jpg';

const LEGACY_SEEN_KEY = (wallet: string) => `blotto:notify-seen:${wallet}`;
/** A seen item as stored: an opaque token of `${pool}:${state}`, never the
 * pool address itself (2026-09-16, storage/opaque-key.ts). */
const seenToken = (itemKey: string) => opaqueToken('notify-seen', itemKey);
/** Opaque since 2026-09-16: the key no longer names the wallet, the value no
 * longer lists the pools. A pre-change entry is carried once, tokenised. */
const seenKey = (wallet: string): string | null => {
  const key = opaqueKey('notify-seen', wallet);
  migrateLegacyKey(LEGACY_SEEN_KEY(wallet), key, (old) => {
    try {
      const keys = JSON.parse(old) as string[];
      return JSON.stringify(keys.map(seenToken).filter((t): t is string => t !== null));
    } catch {
      return '[]';
    }
  });
  return key;
};

function readSeen(wallet: string): Set<string> {
  try {
    const key = seenKey(wallet);
    const raw = key === null ? null : localStorage.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeSeen(wallet: string, tokens: Set<string>): void {
  try {
    const key = seenKey(wallet);
    if (key !== null) localStorage.setItem(key, JSON.stringify([...tokens]));
  } catch {
    // Best-effort convenience only.
  }
}

/**
 * The prize a Paid pool paid this wallet, or null. `paid` is the row's own
 * flag; the amount is guarded so a row with `paid` and no lamports (a share
 * held, then forfeited) is not called a win.
 */
function wonSolOf(row: Pick<CareerRow, 'state' | 'paid' | 'amount_lamports'>): string | null {
  if (row.state !== 'Paid' || !row.paid) return null;
  try {
    return BigInt(row.amount_lamports) > 0n ? lamportsToSol(row.amount_lamports) : null;
  } catch {
    return null;
  }
}

/** The item for a pool in a state, or null for a state with nothing to say. */
export function itemFor(
  row: Pick<CareerRow, 'pool' | 'pool_id' | 'state' | 'paid' | 'amount_lamports'> & Partial<Pick<CareerRow, 'rank'>>,
  closedUnix: string | null = null
): NotifyItem | null {
  if (!row.state || row.pool_id === null) return null;
  const base = {
    key: `${row.pool}:${row.state}`,
    poolId: row.pool_id,
    pool: row.pool,
    state: row.state,
    rank: typeof row.rank === 'number' ? row.rank : null,
    closedUnix,
  };
  switch (row.state) {
    case 'Sealed':
      return { ...base, message: COPY.notify.sealed(row.pool_id), toResults: false, wonSol: null };
    case 'Scored':
      return { ...base, message: COPY.notify.scored(row.pool_id), toResults: true, wonSol: null };
    case 'Paid': {
      const wonSol = wonSolOf(row);
      return {
        ...base,
        message: wonSol ? COPY.notify.won(row.pool_id, wonSol) : COPY.notify.paid(row.pool_id),
        toResults: true,
        wonSol,
      };
    }
    case 'Refunding':
      return { ...base, message: COPY.notify.refunding(row.pool_id), toResults: false, wonSol: null };
    default:
      return null;
  }
}

/** The Position cell: the archive's rank where there is one, else the state. */
export function positionLabel(item: Pick<NotifyItem, 'state' | 'rank' | 'wonSol'>): string {
  if (item.state === 'Sealed') return COPY.notify.positionSealed;
  if (item.state === 'Refunding') return COPY.notify.positionRefund;
  if (item.rank !== null) return COPY.notify.positionRank(item.rank);
  if (item.wonSol !== null) return COPY.notify.positionWinner;
  return COPY.notify.positionPending;
}

/**
 * The sheet's body: the clip, then the table. Pure over its props, so the
 * dev gallery can show it with fixture rows and the bell owns only the
 * reading and the seen set.
 */
export function NotificationsPanel({
  items,
  seen = new Set(),
  onView,
}: {
  items: NotifyItem[];
  /** Item keys whose results have been opened from here on this device. */
  seen?: ReadonlySet<string>;
  /** A row's link was followed: mark it seen, close the sheet. */
  onView?: (key: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="relative -mx-1 h-28 overflow-hidden rounded-2xl bg-brand-berry sm:h-36">
        <AmbientClip tiers={CLIP} poster={POSTER} className="absolute inset-0 h-full w-full object-cover" />
      </div>
      {items.length === 0 ? (
        <div className="flex flex-col gap-1 pb-2">
          <p className="text-[17px] font-medium text-ink">{COPY.notify.emptyTitle}</p>
          <p className="text-[14px] leading-5 text-ink-muted">{COPY.notify.empty}</p>
        </div>
      ) : (
        <div className="max-h-80 overflow-auto rounded-2xl border border-white/10 bg-white/5">
          <table className="w-full min-w-[420px] border-collapse text-[14px]" aria-label={COPY.notify.tableAria}>
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
              {items.map((i) => {
                const gold = i.wonSol !== null;
                const isNew = !seen.has(i.key);
                const href = i.toResults ? `/pools/${i.pool}/results` : `/pools/${i.pool}`;
                return (
                  <tr
                    key={i.key}
                    data-testid="notify-row"
                    data-new={isNew ? '1' : '0'}
                    className={'border-t border-line ' + (gold ? 'font-semibold text-prize' : 'text-ink')}
                  >
                    <td className="px-3 py-2.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="tnum">{COPY.reveal.passPool(i.poolId)}</span>
                        {isNew ? (
                          <span
                            data-testid="notify-new"
                            className="rounded-full bg-brand px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-(--color-base)"
                          >
                            {COPY.notify.newTag}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="tnum px-3 py-2.5">{positionLabel(i)}</td>
                    <td className="tnum px-3 py-2.5 whitespace-nowrap text-ink-muted">{formatDay(i.closedUnix) || COPY.notify.positionPending}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Link
                        href={href}
                        onClick={() => onView?.(i.key)}
                        className={'whitespace-nowrap underline underline-offset-2 ' + (gold ? 'text-prize' : 'text-ink hover:text-brand')}
                      >
                        {i.toResults ? COPY.notify.viewResults : COPY.notify.viewPool}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function NotificationsBell() {
  const auth = useAuth();
  const toast = useToast();
  const wallet = auth.status === 'signed-in' ? auth.walletAddress : null;
  const [items, setItems] = useState<NotifyItem[]>([]);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);

  // Founder 2026-09-09: "users can be alerted when a pool fills so they can
  // go and check the result." While the site is open the bell re-reads the
  // career every POLL_MS; a pool of yours reaching a new state raises a
  // toast the moment it lands, not only on the next visit. (Email and push
  // for the closed-tab case are a separate delivery, not this poll.)
  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    let known: Set<string> | null = null;
    const api = indexerApi();
    const load = () =>
      Promise.all([api.getCareer(wallet), api.listPools().catch(() => [])])
        .then(([career, pools]) => {
          if (cancelled) return;
          const closed = new Map(pools.map((p) => [p.pool, p.fill_deadline]));
          const next = career.flatMap((row) => {
            const item = itemFor(row, closed.get(row.pool) ?? null);
            return item ? [item] : [];
          });
          setItems(next.reverse());
          setSeen(readSeen(wallet));
          // A state that arrived since the last read is announced once.
          if (known) {
            for (const i of next) if (!known.has(i.key)) toast.show(i.message);
          }
          known = new Set(next.map((i) => i.key));
        })
        .catch(() => {
          // The bell renders with nothing — the pages still show live state.
        });
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [wallet, toast]);

  // A row's results opened from here: seen, on this device, from now on.
  const onView = useCallback(
    (key: string) => {
      setOpen(false);
      if (!wallet) return;
      const token = seenToken(key);
      if (token === null) return;
      setSeen((prev) => {
        const next = new Set(prev);
        next.add(token);
        writeSeen(wallet, next);
        return next;
      });
    },
    [wallet]
  );

  if (!wallet) return null;

  // The seen set holds tokens; the panel is asked by item key.
  const seenKeys = new Set(items.filter((i) => seen.has(seenToken(i.key) ?? '')).map((i) => i.key));
  const unseen = items.length - seenKeys.size;

  return (
    <>
      {/* A chip in the row with the balance and the address (round four A2). */}
      <button
        type="button"
        data-testid="notifications-bell"
        aria-label={`${COPY.notify.title}${unseen > 0 ? ` (${unseen} new)` : ''}`}
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1.5 font-mono text-xs text-ink transition-colors hover:border-brand"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
          <path
            d="M6 9.5a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13.5 6 9.5Zm4 8.5a2 2 0 0 0 4 0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {unseen > 0 && (
          <span
            className="tnum flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-(--color-base)"
            aria-hidden
          >
            {unseen}
          </span>
        )}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={COPY.notify.title}>
        <NotificationsPanel items={items} seen={seenKeys} onView={onView} />
      </Sheet>
    </>
  );
}
