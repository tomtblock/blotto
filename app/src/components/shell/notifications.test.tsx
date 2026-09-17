/*
 * The notifications sheet's derivation (round four A2, 2026-09-17): a Paid
 * pool that paid THIS wallet is a win and reads as one; a Paid pool that
 * did not is the plain "prizes are paid" line; the other states are
 * unchanged. Rendered with react-dom/server, no DOM (vitest.config.mts).
 */
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { COPY } from '@/copy';
import { FIXTURE_CAREER } from '@/data/scenarios';
import { NotificationsPanel, itemFor } from './notifications';

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
    const item = itemFor(row());
    expect(item?.wonSol).toBe('4');
    expect(item?.message).toBe(COPY.notify.won('16', '4'));
    expect(item?.toResults).toBe(true);
    expect(item?.key).toBe(`${row().pool}:Paid`);
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

describe('NotificationsPanel', () => {
  it('leads with the win over the fixture career, then lists every item', () => {
    const items = FIXTURE_CAREER.flatMap((r) => {
      const i = itemFor(r);
      return i ? [i] : [];
    });
    const win = items.find((i) => i.wonSol !== null) ?? null;
    const html = renderToString(<NotificationsPanel items={items} win={win} />).replaceAll('<!-- -->', '');
    expect(html).toContain(COPY.notify.wonHeadline);
    expect(html).toContain(COPY.notify.wonLine('4'));
    expect(html).toContain('data-testid="notify-win"');
    expect(html).toContain(COPY.notify.refunding('FIXTURE-REFUNDING'));
    expect(html).toContain(COPY.notify.sealed('FIXTURE-SEALED'));
  });

  it('lists a win plainly until the bell has confirmed it', () => {
    const items = [itemFor(row())!];
    const html = renderToString(<NotificationsPanel items={items} />).replaceAll('<!-- -->', '');
    expect(html).toContain(COPY.notify.won('16', '4'));
    expect(html).not.toContain('notify-win');
  });

  it('says so when there is nothing yet', () => {
    const html = renderToString(<NotificationsPanel items={[]} />);
    expect(html).toContain(COPY.notify.emptyTitle);
    expect(html).not.toContain('notify-win');
  });
});
