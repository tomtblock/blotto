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
    expect(html).toContain('6.5'); // 13 half-points, integer arithmetic only
    expect(html).not.toContain('½'); // the glyph read as a percentage (round four A2)
    expect(html).toContain(c.battleScoreNote);
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

  /*
   * D-E19 (the Ladder): a pool pays its highest places, so every paid row is
   * listed (not rank 1 alone) and the table draws the paid line once, after
   * the last paid row — a tie straddling the line is paid on both sides.
   */
  it('lists every paid place with its amount, and draws the paid line once after the last paid row', () => {
    const rows = [
      row({ player: 'A111111111111111111111111111111111111111111', rank: 1, amount_lamports: '300000000', seat: 0 }),
      row({ player: 'B111111111111111111111111111111111111111111', rank: 2, amount_lamports: '100000000', seat: 1 }),
      // A tie for 2nd across the paid line of a pool of 8 (2 places): the
      // 2nd prize shared, so both are paid.
      row({ player: 'C111111111111111111111111111111111111111111', rank: 2, amount_lamports: '100000000', seat: 2 }),
      row({ player: 'D111111111111111111111111111111111111111111', rank: 4, amount_lamports: '0', seat: 3 }),
    ];
    const html = renderToString(<ArchiveStandings archive={archive(rows)} paidPlaces={2} />).replaceAll('<!-- -->', '');
    expect(html).toContain(c.paidTitle);
    expect(html).toContain(c.paidRow(1, 'A1111111…', '0.3'));
    expect(html).toContain(c.paidRow(2, 'B1111111…', '0.1'));
    expect(html).toContain(c.paidRow(2, 'C1111111…', '0.1'));
    expect(html).not.toContain('D1111111… —');
    // The line, once, between the last paid row and the first unpaid one.
    expect(html.match(/data-testid="paid-line"/g)?.length).toBe(1);
    expect(html).toContain(c.paidLine(2));
    expect(c.paidLine(2)).toBe('Prizes were paid to 1st–2nd.');
    const line = html.indexOf('data-testid="paid-line"');
    expect(html.indexOf('C1111111…', html.indexOf('<tbody'))).toBeLessThan(line);
    expect(html.indexOf('D1111111…', html.indexOf('<tbody'))).toBeGreaterThan(line);
    // No winner wording survives.
    expect(html).not.toMatch(/winner/i);
  });

  it('says a one-place pool paid 1st place, in the same plain line', () => {
    expect(c.paidLine(1)).toBe('The prize was paid to 1st place.');
    const html = render([row(), row({ player: 'Bbbb1111111111111111111111111111111111111111', rank: 2, amount_lamports: '0' })]);
    expect(html).toContain(c.paidLine(1));
  });
});
