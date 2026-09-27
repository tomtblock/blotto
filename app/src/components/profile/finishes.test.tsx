/*
 * The profile's previous finishes (V3): the rows are the career newest
 * first; a pool with no id is left out; the position is the verified rank
 * where there is one and the state otherwise (the bell's rule); the date is
 * the pool's fill deadline; a paid finish is a win and its row is gold.
 * Rendered with react-dom/server, no DOM (vitest.config.mts).
 */
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { COPY } from '@/copy';
import { FIXTURE_CAREER } from '@/data/scenarios';
import { Finishes, finishRows } from './finishes';

describe('finishRows', () => {
  it('lists the career newest first, with the bell\'s position rule and the pool\'s closing day', () => {
    const closed = new Map(FIXTURE_CAREER.map((r) => [r.pool, '1790000000']));
    const rows = finishRows(FIXTURE_CAREER, closed);
    expect(rows.map((r) => r.poolId)).toEqual([...FIXTURE_CAREER].reverse().map((r) => r.pool_id));
    const paid = rows.find((r) => r.poolId === 'FIXTURE-PAID')!;
    expect(paid.position).toBe(COPY.notify.positionRank(1));
    expect(paid.won).toBe(true);
    expect(paid.toResults).toBe(true);
    expect(paid.day).toBe('21 Sept 2026');
    const sealed = rows.find((r) => r.poolId === 'FIXTURE-SEALED')!;
    expect(sealed.position).toBe(COPY.notify.positionSealed);
    expect(sealed.won).toBe(false);
    expect(sealed.toResults).toBe(false);
  });

  it('leaves out a row with no pool id and shows a missing date as pending', () => {
    const rows = finishRows(
      [
        { ...FIXTURE_CAREER[0]!, pool_id: null },
        { ...FIXTURE_CAREER[0]!, pool: 'Other111111111111111111111111111111111111111', pool_id: '77', state: 'Open', rank: null },
      ],
      new Map()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.poolId).toBe('77');
    expect(rows[0]!.position).toBe(COPY.notify.positionPending);
    expect(rows[0]!.day).toBe('');
  });
});

describe('Finishes', () => {
  it('renders the empty line without rows and a gold row for a win', () => {
    expect(renderToString(<Finishes rows={[]} />)).toContain(COPY.profile.finishes.empty);
    const html = renderToString(<Finishes rows={finishRows(FIXTURE_CAREER, new Map())} />);
    expect(html).toContain(COPY.reveal.passPool('FIXTURE-PAID'));
    expect(html).toContain('text-prize');
    expect(html).toContain(COPY.notify.viewResults);
  });
});
