'use client';

/*
 * The appeal form (Phase 2 Stage E) — the published route made usable:
 * "You may appeal within 7 days of being notified, and the appeal is
 * decided by a different reviewer within a further 7 days."
 *
 * Renders ONLY for the signed-in wallet whose own share was forfeited on
 * this pool (the entry's `escrow_settled === 'forfeited'`), and only after
 * the review service confirms there is an upheld flag to appeal. The
 * player writes their grounds, the wallet signs the canonical appeal
 * message, and the service appends the lodge to the same signed log the
 * reviewers write to. Spectators never see this; nothing here can move a
 * lamport.
 */

import { useEffect, useState } from 'react';
import { COPY } from '@/copy';
import { useAuth } from '@/wallet/auth-context';
import { fetchAppealPosition, lodgeAppeal, type AppealPosition, type LodgeOutcome } from './appeal';

const REVIEW_API = process.env.NEXT_PUBLIC_REVIEW_API_URL;

export function AppealClient({ pool, forfeitedPlayers }: { pool: string; forfeitedPlayers: string[] }) {
  const auth = useAuth();
  const wallet = auth.status === 'signed-in' ? auth.walletAddress : null;
  const mine = wallet !== null && forfeitedPlayers.includes(wallet);
  const [position, setPosition] = useState<AppealPosition | null>(null);
  const [grounds, setGrounds] = useState('');
  const [outcome, setOutcome] = useState<LodgeOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  // The position is read from the public log once the viewer is known to
  // be the affected wallet, and re-read after a lodge. The fetch settles
  // asynchronously; a stale response after an unmount or a wallet change is
  // dropped rather than applied.
  useEffect(() => {
    if (!mine || !wallet) return;
    let cancelled = false;
    fetchAppealPosition(REVIEW_API, pool, wallet).then((p) => {
      if (!cancelled) setPosition(p);
    });
    return () => {
      cancelled = true;
    };
  }, [mine, pool, wallet]);

  if (!mine || !wallet || !position || !position.forfeit) return null;

  const submit = async () => {
    const signer = auth.signers.find((s) => s.address === wallet);
    setBusy(true);
    const result = await lodgeAppeal(REVIEW_API, signer, pool, wallet, grounds.trim());
    setOutcome(result);
    setBusy(false);
    if (result === 'lodged') setPosition(await fetchAppealPosition(REVIEW_API, pool, wallet));
  };

  const c = COPY.results.appeal;
  return (
    <section className="mb-5 rounded-xl border border-line p-5">
      <h2 className="font-display text-[18px] font-bold text-ink">{c.title}</h2>
      <p className="mt-1 max-w-prose text-[13px] leading-5 text-ink-muted">{c.note}</p>
      {position.decided ? (
        <p className="mt-3 text-[13px] text-ink">
          {position.decided.action === 'appeal_upheld' ? c.upheld : c.dismissed}
        </p>
      ) : position.lodged ? (
        <p className="mt-3 text-[13px] text-ink">{c.lodgedOn(position.lodged.decidedAt)}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <label className="text-[12px] uppercase tracking-[0.1em] text-ink-muted" htmlFor="appeal-grounds">
            {c.groundsLabel}
          </label>
          <textarea
            id="appeal-grounds"
            className="min-h-24 rounded-lg border border-line bg-transparent p-3 text-[14px] text-ink"
            maxLength={2000}
            value={grounds}
            onChange={(e) => setGrounds(e.target.value)}
          />
          <p className="text-[12px] text-ink-muted">{c.windowNote(position.lodgeUntil ?? '')}</p>
          <button
            type="button"
            disabled={busy || grounds.trim().length === 0}
            onClick={submit}
            className="h-11 rounded-xl border border-line px-4 text-[14px] font-medium text-ink transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
          >
            {c.submit}
          </button>
          {outcome && outcome !== 'lodged' && (
            <p className="text-[13px] text-ink-muted">{c.outcome[outcome]}</p>
          )}
        </div>
      )}
    </section>
  );
}
