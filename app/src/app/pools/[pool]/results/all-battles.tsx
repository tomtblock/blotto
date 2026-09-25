'use client';

/*
 * Every battle of every player (founder 2026-09-09: "an environment where
 * everyone can view the leaderboard and all battles after, for complete
 * transparency"). Rendered ONLY under a verified archive — the read API
 * served a leaderboard, which it does only for a pool whose published
 * bundle recomputed to the on-chain commitment — and fed by that bundle's
 * own bytes, fetched from its permanent URI in the browser: the same file
 * the Verify page recomputes, so this table cannot show anything the
 * player could not fetch themselves.
 *
 * SEALING: nothing here exists before the pool is published; the bundle is
 * the reveal. An entry whose plaintext is absent from the bundle (a missing
 * reveal, scored by the published missing-battle rule) shows as not
 * revealed rather than as numbers.
 *
 * Display only, integer only: `decodeBattleSet` is the scoring engine's own
 * decoder (R20 — one module, crank and browser); nothing here is fed back.
 */

import { useEffect, useState } from 'react';
import { decodeBattleSet } from '@blotto/scoring';
import { COPY } from '@/copy';
import { bundleMode, type PublishedBundle } from '@/verify/logic';
import { NeonSection } from '@/components/ui/neon-section';

const unhex = (s: string) => {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};

interface Row {
  seat: number;
  playerShort: string;
  /** Seven battles of five integers, or null when not revealed. */
  battles: ReadonlyArray<readonly number[]> | null;
}

export function AllBattles({ uri }: { uri: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || rows) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(uri, { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const bundle = (await res.json()) as PublishedBundle;
        // Phase B: decode under the bundle's own rule (70 bytes in hard).
        const mode = bundleMode(bundle);
        const next: Row[] = [...bundle.entries]
          .sort((a, b) => a.index - b.index)
          .map((e) => {
            let battles: Row['battles'] = null;
            if (e.battles !== null) {
              try {
                battles = decodeBattleSet(unhex(e.battles), mode);
              } catch {
                battles = null;
              }
            }
            return { seat: e.index, playerShort: `${e.player.slice(0, 8)}…`, battles };
          });
        if (!cancelled) setRows(next);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, rows, uri]);

  return (
    <NeonSection heading={COPY.results.allBattles.title} data-testid="all-battles">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-[13px] leading-5 text-ink-muted">{COPY.results.allBattles.note}</p>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="key-cream h-11 shrink-0 rounded-full px-5 text-[14px] font-semibold"
        >
          {open ? COPY.results.allBattles.hide : COPY.results.allBattles.show}
        </button>
      </div>
      {open && failed && <p className="text-[13px] text-ink-muted">{COPY.results.allBattles.failed}</p>}
      {open && !failed && !rows && (
        <p aria-live="polite" className="text-[13px] text-ink-muted">
          {COPY.results.allBattles.loading}
        </p>
      )}
      {open && rows && (
        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
          <table className="w-full min-w-[640px] border-collapse text-[12px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                <th className="px-3 py-2 font-medium">{COPY.results.allBattles.seat}</th>
                <th className="px-3 py-2 font-medium">{COPY.results.archive.player}</th>
                {Array.from({ length: 7 }, (_, k) => (
                  <th key={k} className="px-2 py-2 text-center font-medium">
                    {COPY.results.allBattles.battle(k + 1)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.seat} className="border-t border-line">
                  <td className="tnum px-3 py-2 text-ink">{r.seat}</td>
                  <td className="px-3 py-2 font-mono text-ink-muted">{r.playerShort}</td>
                  {r.battles
                    ? r.battles.map((b, k) => (
                        <td key={k} className="tnum px-2 py-2 text-center font-mono text-ink">
                          {b.join('·')}
                        </td>
                      ))
                    : Array.from({ length: 7 }, (_, k) => (
                        <td key={k} className="px-2 py-2 text-center text-ink-muted">
                          {k === 0 ? COPY.results.allBattles.notRevealed : '—'}
                        </td>
                      ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </NeonSection>
  );
}
