'use client';

/*
 * The admin review page (roadmap 4.4, wired to the C10 review service):
 * flagged entries in a pool, a decision per row — WALLET-SIGNED. The page
 * signs the same canonical message the server verifies (one shared module,
 * backend/detection/src/review-message.ts), with the signed-in wallet as
 * the reviewer; the server accepts only wallets in the founder-maintained
 * member list (config/reviewers.json). The pool's decision log renders
 * below the table so a reviewer sees the record they are appending to.
 *
 * Admin surface: raw strings by design (not player copy — same as the dev
 * pages; the COPY module owns player-facing language only).
 */

import { useCallback, useState } from 'react';
import { canonicalReviewMessage } from '@blotto/detection/review-message';
import { indexerApi } from '@/data/api';
import type { EntryRow } from '@/data/types';
import { useAuth } from '@/wallet/auth-context';

const REVIEW_API = process.env.NEXT_PUBLIC_REVIEW_API_URL;

interface LoggedDecision {
  player: string;
  action: string;
  criterion: string;
  decidedBy: string;
  decidedAt: string;
}

export function ReviewClient() {
  const auth = useAuth();
  const [pool, setPool] = useState('');
  const [flagged, setFlagged] = useState<EntryRow[] | null>(null);
  const [log, setLog] = useState<LoggedDecision[]>([]);
  const [criterion, setCriterion] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus(null);
    const entries = await indexerApi().getEntries(pool);
    setFlagged(entries.filter((e) => e.flagged || e.escrow_settled !== null));
    if (REVIEW_API) {
      try {
        const res = await fetch(`${REVIEW_API}/decisions?pool=${encodeURIComponent(pool)}`);
        setLog(res.ok ? ((await res.json()) as { decisions: LoggedDecision[] }).decisions : []);
      } catch {
        setLog([]);
      }
    }
  }, [pool]);

  const act = async (player: string, action: 'clear' | 'forfeit' | 'release' | 'flag') => {
    if (!REVIEW_API) {
      setStatus('review service not configured (NEXT_PUBLIC_REVIEW_API_URL)');
      return;
    }
    if (auth.status !== 'signed-in' || !auth.walletAddress) {
      setStatus('sign in with a reviewer wallet first');
      return;
    }
    const signer = auth.signers.find((s) => s.address === auth.walletAddress);
    if (!signer?.signMessage) {
      setStatus('this wallet cannot sign messages — decisions must be wallet-signed');
      return;
    }
    if (!criterion.trim()) {
      setStatus('cite a published criterion before deciding');
      return;
    }
    const decidedAt = new Date().toISOString();
    let signature: Uint8Array;
    try {
      signature = await signer.signMessage(
        canonicalReviewMessage({
          pool,
          player,
          action,
          criterion: criterion.trim(),
          signedAt: decidedAt,
        })
      );
    } catch {
      setStatus('signing was declined — nothing submitted');
      return;
    }
    const res = await fetch(`${REVIEW_API}/decisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pool,
        player,
        action,
        criterion: criterion.trim(),
        decidedBy: auth.walletAddress,
        decidedAt,
        signature: btoa(String.fromCharCode(...signature)),
      }),
    });
    setStatus(
      res.ok
        ? `${action}: ${player.slice(0, 8)}… recorded`
        : res.status === 401
          ? 'refused: this wallet is not in the reviewer list'
          : `failed: ${res.status}`
    );
    if (res.ok) await load();
  };

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl">Review</h1>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded border bg-transparent p-2 font-mono text-sm"
          placeholder="pool address"
          value={pool}
          onChange={(e) => setPool(e.target.value)}
        />
        <button type="button" className="rounded border px-4" onClick={load}>
          Load
        </button>
      </div>
      <input
        className="rounded border bg-transparent p-2 text-sm"
        placeholder="criterion the decision cites (from the published list)"
        value={criterion}
        onChange={(e) => setCriterion(e.target.value)}
      />
      {status && <p className="text-sm opacity-80">{status}</p>}
      {flagged && flagged.length === 0 && <p className="opacity-70">Nothing flagged in this pool.</p>}
      {flagged && flagged.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="opacity-60">
              <th className="py-2">Player</th>
              <th>Seat</th>
              <th>State</th>
              <th className="text-right">Decision</th>
            </tr>
          </thead>
          <tbody>
            {flagged.map((e) => (
              <tr key={e.player} className="border-t">
                <td className="py-2 font-mono">{e.player.slice(0, 12)}…</td>
                <td>#{e.idx}</td>
                <td>{e.escrow_settled ?? (e.flagged ? 'flagged' : '—')}</td>
                <td className="text-right">
                  <div className="flex justify-end gap-2">
                    <button type="button" className="rounded border px-2 py-1" onClick={() => act(e.player, 'clear')}>
                      Clear
                    </button>
                    <button type="button" className="rounded border px-2 py-1" onClick={() => act(e.player, 'release')}>
                      Release
                    </button>
                    <button type="button" className="rounded border px-2 py-1" onClick={() => act(e.player, 'forfeit')}>
                      Forfeit
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {log.length > 0 && (
        <div>
          <h2 className="mb-2 text-lg">Decision log</h2>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="opacity-60">
                <th className="py-2">At</th>
                <th>Player</th>
                <th>Action</th>
                <th>Criterion</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {log.map((d, i) => (
                <tr key={i} className="border-t">
                  <td className="py-2 font-mono text-xs">{d.decidedAt}</td>
                  <td className="font-mono">{d.player.slice(0, 8)}…</td>
                  <td>{d.action}</td>
                  <td>{d.criterion}</td>
                  <td className="font-mono">{d.decidedBy.slice(0, 8)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
