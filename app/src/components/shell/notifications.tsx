'use client';

/*
 * In-app notifications (v3 D3): a bell in the header, a bottom sheet of
 * FACTUAL state changes for pools this wallet entered — sealed, results
 * committed, prizes paid, refunds open. Derived client-side from the read
 * API (career rows × pool state); "unseen" is a per-device localStorage
 * set, so the badge is a convenience, never a server-side signal.
 *
 * The email toggle records the wallet-signed opt-in with the entry service
 * (see src/entry/notify.ts). Opt-in only; nothing here asks twice, counts
 * anything down, or prompts re-entry — retention is mastery and standing
 * (D-UI-2), and the do-not-build vocabulary is CI-enforced.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { COPY } from '@/copy';
import { indexerApi } from '@/data/api';
import { useAuth } from '@/wallet/auth-context';
import { Sheet } from '@/components/ui/sheet';
import { showToast } from "@/components/ui/toaster";
import { submitNotifyPreference } from '@/entry/notify';

interface Item {
  key: string;
  poolId: string;
  pool: string;
  message: string;
  /** Results-page states link there; others to the pool page. */
  toResults: boolean;
}

const seenKey = (wallet: string) => `blotto:notify-seen:${wallet}`;
const emailKey = (wallet: string) => `blotto:notify-email:${wallet}`;

function readSeen(wallet: string): Set<string> {
  try {
    const raw = localStorage.getItem(seenKey(wallet));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function itemFor(state: string, poolId: string): { message: string; toResults: boolean } | null {
  switch (state) {
    case 'Sealed':
      return { message: COPY.notify.sealed(poolId), toResults: false };
    case 'Scored':
      return { message: COPY.notify.scored(poolId), toResults: true };
    case 'Paid':
      return { message: COPY.notify.paid(poolId), toResults: true };
    case 'Refunding':
      return { message: COPY.notify.refunding(poolId), toResults: false };
    default:
      return null;
  }
}

export function NotificationsBell() {
  const auth = useAuth();
  const wallet = auth.status === 'signed-in' ? auth.walletAddress : null;
  const [items, setItems] = useState<Item[]>([]);
  const [unseen, setUnseen] = useState(0);
  const [open, setOpen] = useState(false);
  // Keyed by wallet; until the wallet toggles in this session, the display
  // state comes straight from the device cache (read in render — client
  // component, guarded for SSR and blocked storage).
  const [emailPref, setEmailPref] = useState<{ wallet: string; on: boolean } | null>(null);
  const emailOn =
    emailPref && emailPref.wallet === wallet
      ? emailPref.on
      : (() => {
          try {
            return typeof window !== 'undefined' && wallet !== null
              ? localStorage.getItem(emailKey(wallet)) === '1'
              : false;
          } catch {
            return false;
          }
        })();
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState(false);

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    indexerApi()
      .getCareer(wallet)
      .then((career) => {
        if (cancelled) return;
        const next = career.flatMap((row) => {
          if (!row.state || row.pool_id === null) return [];
          const item = itemFor(row.state, row.pool_id);
          return item
            ? [
                {
                  key: `${row.pool}:${row.state}`,
                  poolId: row.pool_id,
                  pool: row.pool,
                  message: item.message,
                  toResults: item.toResults,
                },
              ]
            : [];
        });
        setItems(next.reverse());
        const seen = readSeen(wallet);
        setUnseen(next.filter((i) => !seen.has(i.key)).length);
      })
      .catch(() => {
        // The bell renders with nothing — the pages still show live state.
      });
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  const openSheet = useCallback(() => {
    setOpen(true);
    if (!wallet) return;
    try {
      localStorage.setItem(seenKey(wallet), JSON.stringify(items.map((i) => i.key)));
    } catch {
      // Best-effort convenience only.
    }
    setUnseen(0);
  }, [wallet, items]);

  const onEmailToggle = useCallback(
    async (next: boolean) => {
      if (!wallet || emailBusy) return;
      setEmailBusy(true);
      setEmailError(false);
      const signer = auth.status === 'signed-in'
        ? auth.signers.find((s) => s.address === wallet)
        : undefined;
      const ok = await submitNotifyPreference(
        process.env.NEXT_PUBLIC_ENTRY_API_URL,
        signer,
        wallet,
        next
      );
      setEmailBusy(false);
      if (ok) {
        setEmailPref({ wallet, on: next });
        try {
          localStorage.setItem(emailKey(wallet), next ? '1' : '0');
        } catch {
          // Preference is recorded server-side either way.
        }
        showToast(COPY.notify.emailSaved);
      } else {
        setEmailError(true);
      }
    },
    [wallet, emailBusy, auth]
  );

  if (!wallet) return null;

  return (
    <>
      <button
        type="button"
        aria-label={`${COPY.notify.title}${unseen > 0 ? ` (${unseen} new)` : ''}`}
        onClick={openSheet}
        className="relative rounded-full p-1.5 text-ink-muted transition-colors hover:text-ink"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
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
            className="tnum absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-(--color-base)"
            aria-hidden
          >
            {unseen}
          </span>
        )}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={COPY.notify.title}>
        {items.length === 0 ? (
          <div className="flex flex-col gap-1 pb-2">
            <p className="text-[15px] font-medium text-ink">{COPY.notify.emptyTitle}</p>
            <p className="text-[13px] leading-5 text-ink-muted">{COPY.notify.empty}</p>
          </div>
        ) : (
          <ul className="mb-4 flex max-h-72 flex-col gap-1 overflow-y-auto">
            {items.map((i) => (
              <li key={i.key}>
                <Link
                  href={i.toResults ? `/pools/${i.pool}/results` : `/pools/${i.pool}`}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-2 py-2 text-[14px] leading-5 text-ink transition-colors hover:bg-overlay"
                >
                  {i.message}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-line pt-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={emailOn}
              disabled={emailBusy}
              onChange={(e) => void onEmailToggle(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-(--color-brand)"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-[14px] font-medium text-ink">{COPY.notify.emailLabel}</span>
              <span className="text-[12px] leading-4 text-ink-muted">{COPY.notify.emailNote}</span>
            </span>
          </label>
          {emailError && (
            <p className="mt-2 text-[13px] leading-5 text-price-down" role="alert">
              {COPY.notify.emailFailed}
            </p>
          )}
        </div>
      </Sheet>
    </>
  );
}
