/*
 * The notifications sheet's derivation: a Paid pool that paid THIS wallet is
 * a win and reads as one (gold); the other states are their own rows; the
 * Position cell is the verified rank where there is one and the state
 * otherwise; a row is "New" until its results were opened from here.
 * Rendered with react-dom/server, no DOM (vitest.config.mts).
 */
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { COPY } from '@/copy';
import { FIXTURE_CAREER } from '@/data/scenarios';
import { NotificationsPanel, itemFor, positionLabel } from './notifications';

const row = (over: Partial<Parameters<typeof itemFor>[0]> = {}) => ({
  pool: 'Poo11111111111111111111111111111111111111111',
  pool_id: '16',
  state: 'Paid' as const,
  paid: true,
  amount_lamports: '4000000000',
  ...over,
});

describe('itemFor', () => {
  it('reads a paid finish as a win, with the amount as the chain holds it', () => {
    const item = itemFor(row(), '1760000000');
    expect(item?.wonSol).toBe('4');
    expect(item?.message).toBe(COPY.notify.won('16', '4'));
    expect(item?.toResults).toBe(true);
    expect(item?.key).toBe(`${row().pool}:Paid`);
    expect(item?.closedUnix).toBe('1760000000');
    expect(item?.rank).toBeNull();
  });

  it('is not a win when the pool paid someone else, or paid nothing to this seat', () => {
    expect(itemFor(row({ paid: false, amount_lamports: '0' }))?.wonSol).toBeNull();
    expect(itemFor(row({ paid: false, amount_lamports: '0' }))?.message).toBe(COPY.notify.paid('16'));
    // `paid` with no lamports (a held share that was forfeited): not a win.
    expect(itemFor(row({ paid: true, amount_lamports: '0' }))?.wonSol).toBeNull();
    expect(itemFor(row({ amount_lamports: 'not-a-number' }))?.wonSol).toBeNull();
  });

  it('keeps the other states, and says nothing for the rest', () => {
    expect(itemFor(row({ state: 'Sealed' }))?.message).toBe(COPY.notify.sealed('16'));
    expect(itemFor(row({ state: 'Refunding' }))?.toResults).toBe(false);
    expect(itemFor(row({ state: 'Open' }))).toBeNull();
    expect(itemFor(row({ state: null }))).toBeNull();
    expect(itemFor(row({ pool_id: null }))).toBeNull();
  });
});

describe('positionLabel', () => {
  it('is the verified rank where there is one, and the state otherwise', () => {
    expect(positionLabel(itemFor(row({ rank: 1 }))!)).toBe(COPY.notify.positionRank(1));
    expect(positionLabel(itemFor(row({ rank: 12, paid: false, amount_lamports: '0' }))!)).toBe(COPY.notify.positionRank(12));
    // A win with no archive rank yet still reads as the winner.
    expect(positionLabel(itemFor(row())!)).toBe(COPY.notify.positionWinner);
    expect(positionLabel(itemFor(row({ paid: false, amount_lamports: '0' }))!)).toBe(COPY.notify.positionPending);
    expect(positionLabel(itemFor(row({ state: 'Sealed' }))!)).toBe(COPY.notify.positionSealed);
    expect(positionLabel(itemFor(row({ state: 'Refunding' }))!)).toBe(COPY.notify.positionRefund);
  });
});

describe('NotificationsPanel', () => {
  const items = FIXTURE_CAREER.flatMap((r) => {
    const i = itemFor(r, '1760000000');
    return i ? [i] : [];
  });

  it('tables every pool, the win in gold, every row new until opened', () => {
    const html = renderToString(<NotificationsPanel items={items} />).replaceAll('<!-- -->', '');
    expect(html).toContain(COPY.notify.colPosition);
    expect(html).toContain(COPY.reveal.passPool('FIXTURE-REFUNDING'));
    expect(html).toContain(COPY.reveal.passPool('FIXTURE-SEALED'));
    expect(html).toContain(COPY.notify.positionRank(1));
    expect(html).toContain('text-prize');
    expect(html).toContain('href="/pools/' + items[0]!.pool + '/results"');
    expect(html.match(/data-testid="notify-new"/g)?.length).toBe(items.length);
    expect(html).not.toContain('Congratulations');
  });

  it('drops the New tag from a row whose results were opened', () => {
    const seen = new Set([items[0]!.key]);
    const html = renderToString(<NotificationsPanel items={items} seen={seen} />).replaceAll('<!-- -->', '');
    expect(html.match(/data-testid="notify-new"/g)?.length).toBe(items.length - 1);
    expect(html).toContain('data-new="0"');
  });

  it('says so when there is nothing yet', () => {
    const html = renderToString(<NotificationsPanel items={[]} />);
    expect(html).toContain(COPY.notify.emptyTitle);
    expect(html).not.toContain('notify-row');
  });
});
