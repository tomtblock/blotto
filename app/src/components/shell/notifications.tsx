'use client';

/*
 * In-app notifications (v3 D3): a bell in the header, a sheet of FACTUAL
 * state changes for pools this wallet entered — sealed, results committed,
 * prizes paid, refunds open. Derived client-side from the read API (career
 * rows × pool state); "unseen" is a per-device localStorage set, so the
 * badge is a convenience, never a server-side signal.
 *
 * THE EMAIL TOGGLE WAS REMOVED (D-E11, founder ruling 2026-09-13). It
 * recorded a wallet-signed opt-in with the entry service for a delivery
 * nothing in this repository can perform: there is no mail code and no
 * provider account. The ruling is to cut the promise now and build the
 * dispatcher later; `POST /notify` and its store stay in place and dormant,
 * and consents already given stay recorded. What remains here — the bell and
 * the sheet — is delivery we actually perform, to an open tab. (The per-pool
 * opt-in with an address is the sealed screen's, 2026-09-17 — entered-panel.)
 *
 * Round four A2 (founder 2026-09-17): the bell is a chip like the balance
 * and the address beside it; the sheet is the site's neon box; and a Paid
 * pool that paid THIS wallet is a win — the top of the sheet says
 * "Congratulations — you won X SOL" over the trophy Blott, with confetti
 * each time the sheet opens on it. The amount is the career row's, the
 * chain's number as a string; nothing here computes one.
 *
 * Nothing here asks twice, counts anything down, or prompts re-entry —
 * retention is mastery and standing (D-UI-2), and the do-not-build
 * vocabulary is CI-enforced.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { COPY } from '@/copy';
import { indexerApi } from '@/data/api';
import { lamportsToSol } from '@/data/format';
import type { CareerRow } from '@/data/types';
import { useAuth } from '@/wallet/auth-context';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { BlottSprite } from '@/components/blott/BlottSprite';
import { ConfettiBurst } from '@/components/celebrate/confetti-burst';
import { migrateLegacyKey, opaqueKey, opaqueToken } from '@/storage/opaque-key';

export interface NotifyItem {
  key: string;
  poolId: string;
  pool: string;
  message: string;
  /** Results-page states link there; others to the pool page. */
  toResults: boolean;
  /** The prize this wallet was paid in this pool, in SOL — a win. */
  wonSol: string | null;
}

/** How often an open tab re-reads the player's pools for a new state. */
const POLL_MS = 60_000;

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

/** The list line for a pool in a state, or null for a state with nothing to say. */
export function itemFor(
  row: Pick<CareerRow, 'pool' | 'pool_id' | 'state' | 'paid' | 'amount_lamports'>
): NotifyItem | null {
  if (!row.state || row.pool_id === null) return null;
  const base = { key: `${row.pool}:${row.state}`, poolId: row.pool_id, pool: row.pool };
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

/**
 * The sheet's body: the win as the headline (when the bell has confirmed
 * one — see `openSheet`), then every item. Pure over its props, so the dev
 * gallery can show it with fixture rows and the bell owns only the reading,
 * the seen set and the confirmation.
 */
export function NotificationsPanel({
  items,
  win = null,
  onNavigate,
}: {
  items: NotifyItem[];
  /** The item to celebrate at the top, or null for the plain list. */
  win?: NotifyItem | null;
  onNavigate?: () => void;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-1 pb-2">
        <p className="text-[17px] font-medium text-ink">{COPY.notify.emptyTitle}</p>
        <p className="text-[14px] leading-5 text-ink-muted">{COPY.notify.empty}</p>
      </div>
    );
  }
  return (
    <>
      {win && (
        <div
          data-testid="notify-win"
          className="mb-4 flex flex-col items-center gap-2 rounded-2xl border border-prize/40 bg-prize/10 px-4 pt-4 pb-5 text-center"
        >
          <BlottSprite pose="trophy" size={96} />
          <p className="font-display text-[30px] leading-[32px] font-extrabold tracking-[0.06em] text-prize uppercase [text-shadow:0_0_14px_rgba(255,222,89,0.7)]">
            {COPY.notify.wonHeadline}
          </p>
          <p className="tnum font-display text-[24px] leading-7 font-bold text-ink">
            {COPY.notify.wonLine(win.wonSol ?? '')}
          </p>
          <p className="text-[13px] text-ink-muted">{COPY.reveal.passPool(win.poolId)}</p>
          <Link
            href={`/pools/${win.pool}/results`}
            onClick={onNavigate}
            className="key-prize mt-1 flex h-12 items-center justify-center rounded-full bg-prize px-6 font-display text-[16px] font-bold uppercase tracking-wide text-(--color-base) hover:bg-prize-hot"
          >
            {COPY.notify.wonSeeResults}
          </Link>
        </div>
      )}
      <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {items.map((i) => (
          <li key={i.key}>
            <Link
              href={i.toResults ? `/pools/${i.pool}/results` : `/pools/${i.pool}`}
              onClick={onNavigate}
              className={
                'block rounded-xl px-3 py-2.5 text-[15px] leading-5 transition-colors hover:bg-white/8 ' +
                (i.wonSol !== null ? 'font-semibold text-prize' : 'text-ink')
              }
            >
              {i.message}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export function NotificationsBell() {
  const auth = useAuth();
  const toast = useToast();
  const wallet = auth.status === 'signed-in' ? auth.walletAddress : null;
  const [items, setItems] = useState<NotifyItem[]>([]);
  const [unseen, setUnseen] = useState(0);
  const [open, setOpen] = useState(false);
  // The win the open sheet celebrates, confirmed against the pool: a share
  // under review (the pool `resolving`, Stage C) is the chain's committed
  // payout but not yet the player's to keep, so the headline and the
  // confetti wait until the pool has resolved; the list line still states
  // the committed amount. Each confirmed opening is one burst (the burst
  // unmounts itself; a new key mounts the next).
  const [win, setWin] = useState<{ item: NotifyItem; opening: number } | null>(null);

  // Founder 2026-09-09: "users can be alerted when a pool fills so they can
  // go and check the result." While the site is open the bell re-reads the
  // career every POLL_MS; a pool of yours reaching a new state raises a
  // toast the moment it lands, not only on the next visit. (Email and push
  // for the closed-tab case are a separate delivery, not this poll.)
  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    let known: Set<string> | null = null;
    const load = () => indexerApi()
      .getCareer(wallet)
      .then((career) => {
        if (cancelled) return;
        const next = career.flatMap((row) => {
          const item = itemFor(row);
          return item ? [item] : [];
        });
        setItems(next.reverse());
        const seen = readSeen(wallet);
        setUnseen(next.filter((i) => !seen.has(seenToken(i.key) ?? '')).length);
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

  const openSheet = useCallback(() => {
    setOpen(true);
    const newest = items.find((i) => i.wonSol !== null) ?? null;
    if (newest) {
      indexerApi()
        .getPool(newest.pool)
        .then((pool) => {
          if (pool && !pool.resolving) setWin((w) => ({ item: newest, opening: (w?.opening ?? 0) + 1 }));
        })
        .catch(() => {
          // Unconfirmed: the list still carries the line.
        });
    }
    if (!wallet) return;
    try {
      const key = seenKey(wallet);
      if (key !== null) {
        const tokens = items.map((i) => seenToken(i.key)).filter((t): t is string => t !== null);
        localStorage.setItem(key, JSON.stringify(tokens));
      }
    } catch {
      // Best-effort convenience only.
    }
    setUnseen(0);
  }, [wallet, items]);

  if (!wallet) return null;

  return (
    <>
      {/* A chip in the row with the balance and the address (round four A2). */}
      <button
        type="button"
        data-testid="notifications-bell"
        aria-label={`${COPY.notify.title}${unseen > 0 ? ` (${unseen} new)` : ''}`}
        onClick={openSheet}
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
        {open && win && <ConfettiBurst key={win.opening} pieces={40} />}
        <NotificationsPanel items={items} win={open ? win?.item ?? null : null} onNavigate={() => setOpen(false)} />
      </Sheet>
    </>
  );
}
