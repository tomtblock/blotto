/*
 * The archive table under D-E8 (founder ruling, 2026-09-12): the on-chain
 * results root commits to `player ‖ rank ‖ amount` and nothing else, so the
 * table has to render two kinds of number without letting a reader take one
 * for the other.
 *
 * Rendered with react-dom/server, no DOM (see vitest.config.mts). What is
 * pinned here is what the audit would otherwise have to catch by eye: a row
 * whose entry number our records do not hold, and a row from an indexer that
 * has not been updated to serve `recomputed` at all.
 */
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { COPY } from '@/copy';
import type { LeaderboardRow, PoolLeaderboard } from '@/data/types';
import { ArchiveStandings } from './archive-standings';

const c = COPY.results.archive;

function row(over: Partial<LeaderboardRow> = {}): LeaderboardRow {
  return {
    player: 'So11111111111111111111111111111111111111112',
    rank: 1,
    amount_lamports: '4000000000',
    seat: 7,
    recomputed: { score_half: 13, zones: 4 },
    ...over,
  };
}

function archive(rows: LeaderboardRow[]): PoolLeaderboard {
  return {
    pool: 'Poo11111111111111111111111111111111111111111',
    uri: 'https://gateway.irys.xyz/TESTbund1e',
    results_root: 'ef'.repeat(32),
    verified_at: '2026-09-01T12:00:00Z',
    committed_fields: ['player', 'rank', 'amount_lamports'],
    rows,
  };
}

/* react-dom/server splits adjacent text nodes with an empty comment
   (`#<!-- -->1`); drop them so assertions read the text a player sees. */
const render = (rows: LeaderboardRow[]) =>
  renderToString(<ArchiveStandings archive={archive(rows)} />).replaceAll('<!-- -->', '');

describe('ArchiveStandings', () => {
  it('renders the committed row and its recomputed score', () => {
    const html = render([row()]);
    expect(html).toContain('#1');
    expect(html).toContain('6½'); // 13 half-points, integer arithmetic only
    expect(html).toContain('4 SOL');
  });

  it('says which numbers the chain holds and which are recomputed', () => {
    const html = render([row()]);
    expect(html).toContain(c.note);
    expect(html).toContain(c.provenance);
  });

  it('shows an entry number our records do not hold as a dash, never "null"', () => {
    const html = render([
      row(),
      row({ player: 'Bbbb1111111111111111111111111111111111111111', rank: 2, amount_lamports: '0', seat: null }),
    ]);
    expect(html).not.toContain('null');
    expect(html).toContain('—');
    // A dash alone tells a screen reader nothing; the reason rides with it.
    expect(html).toContain(c.seatUnknown);
  });

  it('never prints NaN when an indexer omits the recomputed scores', () => {
    // The pre-D-E8 response shape, which the type forbids and the network
    // can still produce. The rank and prize beside it are the chain's and
    // must survive intact.
    const stale = { ...row(), recomputed: undefined } as unknown as LeaderboardRow;
    const html = render([stale]);
    expect(html).not.toContain('NaN');
    expect(html).toContain('#1');
    expect(html).toContain('4 SOL');
  });
});
