/*
 * The stills sweep (2026-09-16, the founder's data-minimisation ruling of
 * 2026-09-15): the rule is pure and pinned; the sweep is run against a fake
 * store and a fake indexer so the "never delete on a failed read" clause is
 * proven rather than hoped for.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  rows: [] as { pool: string }[],
  forgotten: [] as string[],
}));

vi.mock('./stills', () => ({
  allStills: async () => store.rows.map((r) => ({ ...r, key: `${r.pool}:1`, battle: 1, png: null, lockedAt: 1 })),
  forgetStills: async (pool: string) => {
    store.forgotten.push(pool);
    store.rows = store.rows.filter((r) => r.pool !== pool);
  },
}));

import { shouldForgetStills, sweepStills } from './stills-sweep';
import type { IndexerApi, PoolSummary } from '@/data/types';

const summary = (
  state: PoolSummary['state'],
  secret: string | null
): Pick<PoolSummary, 'state' | 'secret'> => ({
  state,
  secret,
});

describe('shouldForgetStills — the rule', () => {
  it('forgets a pool that refunded or closed unrevealed', () => {
    expect(shouldForgetStills(summary('Refunding', null))).toBe(true);
    expect(shouldForgetStills(summary('Closed', null))).toBe(true);
  });

  it('keeps an open pool, and every pool whose allocation was published', () => {
    expect(shouldForgetStills(summary('Open', null))).toBe(false);
    expect(shouldForgetStills(summary('Sealed', null))).toBe(false);
    expect(shouldForgetStills(summary('Scored', 'ff'.repeat(32)))).toBe(false);
    expect(shouldForgetStills(summary('Paid', 'ff'.repeat(32)))).toBe(false);
    // A pool that closed AFTER revealing depicts published data.
    expect(shouldForgetStills(summary('Closed', 'ff'.repeat(32)))).toBe(false);
  });
});

describe('sweepStills — against a fake store and indexer', () => {
  beforeEach(() => {
    store.rows = [{ pool: 'OPEN' }, { pool: 'REFUNDED' }, { pool: 'PAID' }, { pool: 'DOWN' }, { pool: 'GONE' }];
    store.forgotten = [];
  });

  const api = (): IndexerApi =>
    ({
      async getPool(pool: string) {
        if (pool === 'OPEN') return summary('Open', null) as PoolSummary;
        if (pool === 'REFUNDED') return summary('Closed', null) as PoolSummary;
        if (pool === 'PAID') return summary('Paid', 'ff'.repeat(32)) as PoolSummary;
        if (pool === 'DOWN') throw new Error('indexer unreachable');
        return null; // GONE: not known to the indexer
      },
    }) as unknown as IndexerApi;

  it('forgets only the pool whose allocation will never be published', async () => {
    const forgotten = await sweepStills(api());
    expect(forgotten).toEqual(['REFUNDED']);
    expect(store.rows.map((r) => r.pool)).toEqual(['OPEN', 'PAID', 'DOWN', 'GONE']);
  });

  it('never deletes on a failed or absent read', async () => {
    await sweepStills(api());
    expect(store.forgotten).not.toContain('DOWN');
    expect(store.forgotten).not.toContain('GONE');
  });
});
