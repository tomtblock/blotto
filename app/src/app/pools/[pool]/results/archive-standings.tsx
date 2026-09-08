/*
 * E3 (proposal E1 §4): the verified-archive standings — the full ranking,
 * one row per seated player, rendered ONLY when the read API served a
 * leaderboard, which it does only for a pool whose published bundle
 * recomputed to the on-chain commitment. No leaderboard → this section
 * simply is not on the page; "unverified" and "no archive" are deliberately
 * indistinguishable here, exactly as they are at the API.
 *
 * The battle-score column displays `score_half` (half-point integer units,
 * seven battles, max 14) as points — integer arithmetic only, display only:
 * nothing on this page feeds a score back into anything.
 */
import { COPY } from '@/copy';
import { lamportsToSol } from '@/data/format';
import type { PoolLeaderboard } from '@/data/types';
import { Card } from '@/components/ui/card';

/** 13 → "6½", 14 → "7" — half-points to a battles-won label, no floats. */
function battleScoreLabel(scoreHalf: number): string {
  const whole = Math.floor(scoreHalf / 2);
  return scoreHalf % 2 === 0 ? String(whole) : `${whole}½`;
}

const shortAddr = (p: string) => `${p.slice(0, 8)}…`;

export function ArchiveStandings({ archive }: { archive: PoolLeaderboard }) {
  const winners = archive.rows.filter((r) => r.rank === 1);
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-[12px] uppercase tracking-[0.14em] text-ink-muted">
        {COPY.results.archive.title}
      </h2>
      {winners.length > 0 && (
        <p className="mb-3 text-[15px] font-semibold text-ink">
          {winners
            .map((w) =>
              COPY.results.archive.winner(shortAddr(w.player), lamportsToSol(w.amount_lamports))
            )
            .join(' · ')}
        </p>
      )}
      <Card className="mb-3 overflow-x-auto p-1">
        <table className="w-full min-w-[480px] border-collapse text-[13px]">
          <caption className="sr-only">{COPY.results.archive.title}</caption>
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-ink-muted">
              <th className="px-3 py-2 font-medium">{COPY.results.archive.rank}</th>
              <th className="px-3 py-2 font-medium">{COPY.results.archive.seat}</th>
              <th className="px-3 py-2 font-medium">{COPY.results.archive.player}</th>
              <th className="px-3 py-2 text-right font-medium">
                {COPY.results.archive.battleScore}
              </th>
              <th className="px-3 py-2 text-right font-medium">{COPY.results.archive.prize}</th>
            </tr>
          </thead>
          <tbody>
            {archive.rows.map((r) => (
              <tr
                key={r.seat}
                className={
                  'border-t border-line ' + (r.rank === 1 ? 'font-semibold text-ink' : 'text-ink-muted')
                }
              >
                <td className="tnum px-3 py-1.5">#{r.rank}</td>
                <td className="tnum px-3 py-1.5">{r.seat}</td>
                <td className="px-3 py-1.5 font-mono text-[12px]">{shortAddr(r.player)}</td>
                <td className="tnum px-3 py-1.5 text-right">{battleScoreLabel(r.score_half)}</td>
                <td className="tnum px-3 py-1.5 text-right">
                  {r.amount_lamports === '0' ? '—' : `${lamportsToSol(r.amount_lamports)} SOL`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="mb-2 max-w-prose text-[13px] leading-5 text-ink-muted">
        {COPY.results.archive.note}
      </p>
      <p className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
        <a
          href={archive.uri}
          target="_blank"
          rel="noreferrer"
          className="text-ink-muted underline underline-offset-2 hover:text-ink"
        >
          {COPY.results.archive.bundleLink}
        </a>
        <a
          href={`/verify?pool=${archive.pool}`}
          className="text-ink-muted underline underline-offset-2 hover:text-ink"
        >
          {COPY.results.archive.verifyLink}
        </a>
      </p>
    </section>
  );
}
