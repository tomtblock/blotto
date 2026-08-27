'use client';

import { useState } from 'react';
import { indexerApi } from '@/data/api';
import type { EntryRow } from '@/data/types';

const REVIEW_API = process.env.NEXT_PUBLIC_REVIEW_API_URL;

export function ReviewClient() {
  const [pool, setPool] = useState('');
  const [flagged, setFlagged] = useState<EntryRow[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = async () => {
    setStatus(null);
    const entries = await indexerApi().getEntries(pool);
    setFlagged(entries.filter((e) => e.flagged || e.escrow_settled !== null));
  };

  const act = async (player: string, action: 'clear' | 'forfeit' | 'release') => {
    if (!REVIEW_API) {
      setStatus('review service not configured (NEXT_PUBLIC_REVIEW_API_URL)');
      return;
    }
    const res = await fetch(`${REVIEW_API}/decisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pool, player, action }),
    });
    setStatus(res.ok ? `${action}: ${player.slice(0, 8)}… submitted` : `failed: ${res.status}`);
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
                <td>
                  {e.escrow_settled ?? (e.flagged ? 'flagged' : '—')}
                </td>
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
    </section>
  );
}
