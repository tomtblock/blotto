/*
 * E3 (proposal E1 §4): the verified-archive standings — the full ranking,
 * one row per seated player, rendered ONLY when the read API served a
 * leaderboard, which it does only for a pool whose published bundle
 * recomputed to the on-chain commitment. No leaderboard → this section
 * simply is not on the page; "unverified" and "no archive" are deliberately
 * indistinguishable here, exactly as they are at the API.
 *
 * D-E8 (founder ruling, 2026-09-12): the on-chain results root commits to
 * `player ‖ rank ‖ amount` and to nothing else, so this table carries two
 * kinds of number and has to say which is which. The player, the ranking and
 * the prize are held by the chain. The entry number is ours — read from our
 * indexed records of the chain, and absent (a dash) where those records have
 * no entry row. The battle score is recomputed from the published entries.
 * Nothing added here may let a reader take the second kind for the first.
 *
 * The battle-score column displays `recomputed.score_half` (half-point
 * integer units, seven battles, max 14) as points — integer arithmetic only,
 * display only: nothing on this page feeds a score back into anything.
 */
import { COPY } from '@/copy';
import { lamportsToSol } from '@/data/format';
import type { PoolLeaderboard } from '@/data/types';
import { NeonSection } from '@/components/ui/neon-section';

/** Stands in for a number this row does not carry. */
const ABSENT = '—';

/**
 * 13 → "6.5", 14 → "7" — half-points to a battles-won label, no floats: the
 * string is built from the integer halves, never from a division. (Round
 * four A2, founder 2026-09-17: the ½ glyph read as a percentage; a decimal
 * half does not, and the note under the table says what a half is.)
 *
 * PHASE-N-REVIEW (D-E8): the argument is widened and guarded rather than
 * trusted. `recomputed` is required by the type, but the type describes a
 * network payload; an indexer serving the pre-D-E8 shape would otherwise
 * print "NaN½" across a column of committed ranks and prizes. A row whose
 * recomputed score is missing shows the same dash an unknown entry number
 * does — the rank and prize beside it are still the chain's.
 */
function battleScoreLabel(scoreHalf: number | null | undefined): string {
  if (typeof scoreHalf !== 'number' || !Number.isInteger(scoreHalf)) return ABSENT;
  const whole = Math.floor(scoreHalf / 2);
  return scoreHalf % 2 === 0 ? String(whole) : `${whole}.5`;
}

const shortAddr = (p: string) => `${p.slice(0, 8)}…`;

export function ArchiveStandings({ archive }: { archive: PoolLeaderboard }) {
  const winners = archive.rows.filter((r) => r.rank === 1);
  return (
    // Round four A2 (founder 2026-09-17): the standings are a titled neon box
    // like every block on the pink field; the table sits inside it.
    <NeonSection heading={COPY.results.archive.title} data-testid="archive-standings">
      {winners.length > 0 && (
        <p className="mb-3 text-[17px] font-semibold text-prize">
          {winners
            .map((w) =>
              COPY.results.archive.winner(shortAddr(w.player), lamportsToSol(w.amount_lamports))
            )
            .join(' · ')}
        </p>
      )}
      <div className="mb-3 overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
        <table className="w-full min-w-[480px] border-collapse text-[14px]">
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
            {/* Keyed by player, not by entry number: one wallet holds one
                entry in a pool, and the entry number may be null. */}
            {archive.rows.map((r) => (
              <tr
                key={r.player}
                className={
                  'border-t border-line ' + (r.rank === 1 ? 'font-semibold text-ink' : 'text-ink-muted')
                }
              >
                <td className="tnum px-3 py-1.5">#{r.rank}</td>
                <td className="tnum px-3 py-1.5">
                  {typeof r.seat === 'number' ? (
                    r.seat
                  ) : (
                    <>
                      <span aria-hidden="true">{ABSENT}</span>
                      <span className="sr-only">{COPY.results.archive.seatUnknown}</span>
                    </>
                  )}
                </td>
                <td className="px-3 py-1.5 font-mono text-[12px]">{shortAddr(r.player)}</td>
                <td className="tnum px-3 py-1.5 text-right">
                  {battleScoreLabel(r.recomputed?.score_half)}
                </td>
                <td className="tnum px-3 py-1.5 text-right">
                  {r.amount_lamports === '0' ? '—' : `${lamportsToSol(r.amount_lamports)} SOL`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mb-2 max-w-prose text-[13px] leading-5 text-ink-muted">
        {COPY.results.archive.battleScoreNote}
      </p>
      <p className="mb-2 max-w-prose text-[13px] leading-5 text-ink-muted">
        {COPY.results.archive.note}
      </p>
      {/* D-E8: which numbers above the chain holds, and which are recomputed.
          Stated in plain words rather than rendered from `committed_fields`,
          because the field names are wire vocabulary and this line is read by
          players — the copy and that list say the same thing and move
          together. */}
      <p className="mb-2 max-w-prose text-[13px] leading-5 text-ink-muted">
        {COPY.results.archive.provenance}
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
    </NeonSection>
  );
}
