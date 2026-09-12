'use client';

/*
 * The appeal form (Phase 2 Stage E) — the published route made usable:
 * "You may appeal within 7 days of being notified, and the appeal is
 * decided by a different reviewer within a further 7 days."
 *
 * Renders ONLY for the signed-in wallet whose own share was forfeited on
 * this pool (the entry's `escrow_settled === 'forfeited'`, an on-chain
 * fact the page passes in). The player writes their grounds, the wallet
 * signs the canonical appeal message, and the service appends the lodge
 * to the same signed log the reviewers write to. Spectators never see
 * this; nothing here can move a lamport.
 *
 * This file is the STATE: the read, its retry, the grounds and the lodge.
 * The rendering is `appeal-panel.tsx`, a pure function of that state, so
 * that every ending of the read — including a service that is absent or
 * cannot be reached — is a rendering that can be asserted on (audit
 * 2026-09-11, C-04: those two used to render nothing at all).
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@/wallet/auth-context';
import { fetchAppealPosition, lodgeAppeal, type AppealRead, type LodgeOutcome } from './appeal';
import { AppealPanel } from './appeal-panel';

const REVIEW_API = process.env.NEXT_PUBLIC_REVIEW_API_URL;

export function AppealClient({ pool, forfeitedPlayers }: { pool: string; forfeitedPlayers: string[] }) {
  const auth = useAuth();
  const wallet = auth.status === 'signed-in' ? auth.walletAddress : null;
  const mine = wallet !== null && forfeitedPlayers.includes(wallet);
  const [read, setRead] = useState<AppealRead | 'loading'>('loading');
  // Bumped by "Try again"; the effect below re-reads.
  const [attempt, setAttempt] = useState(0);
  const [grounds, setGrounds] = useState('');
  const [outcome, setOutcome] = useState<LodgeOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  // The position is read from the public log once the viewer is known to
  // be the affected wallet, and re-read after a lodge or a retry. The fetch
  // settles asynchronously; a stale response after an unmount or a wallet
  // change is dropped rather than applied.
  useEffect(() => {
    if (!mine || !wallet) return;
    let cancelled = false;
    fetchAppealPosition(REVIEW_API, pool, wallet).then((r) => {
      if (!cancelled) setRead(r);
    });
    return () => {
      cancelled = true;
    };
  }, [mine, pool, wallet, attempt]);

  if (!mine || !wallet) return null;

  const submit = async () => {
    const signer = auth.signers.find((s) => s.address === wallet);
    setBusy(true);
    const result = await lodgeAppeal(REVIEW_API, signer, pool, wallet, grounds.trim());
    setOutcome(result);
    setBusy(false);
    if (result === 'lodged') setRead(await fetchAppealPosition(REVIEW_API, pool, wallet));
  };

  return (
    <AppealPanel
      read={read}
      grounds={grounds}
      busy={busy}
      outcome={outcome}
      onGroundsChange={setGrounds}
      onSubmit={() => void submit()}
      onRetry={() => {
        setRead('loading');
        setAttempt((n) => n + 1);
      }}
    />
  );
}
