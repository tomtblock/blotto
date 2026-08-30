import { describe, expect, it } from 'vitest';
import type { EntryRow, PoolSummary } from '@/data/types';
import type { PublishedBundle } from '@/verify/logic';
import { arenaPhase, lobbyVisual } from './phase';

const pool = (state: PoolSummary['state']): PoolSummary => ({
  pool: 'PooL1111111111111111111111111111111111111111',
  id: 'T',
  tier: 0,
  entry_lamports: '100000000',
  fill_deadline: '4102444800',
  timer_seconds: 15,
  state,
  sealing_pubkey: '11'.repeat(32),
  entrants: 23,
  results_root: null,
  secret: null,
});

const entry = (player: string, idx = 3): EntryRow => ({
  pool: 'PooL1111111111111111111111111111111111111111',
  player,
  idx,
  class: 2,
  battles_hash: '00'.repeat(32),
  flagged: false,
  refunded: false,
  escrow_settled: null,
});

const BUNDLE = { pool_id: 'T' } as PublishedBundle;

describe('arenaPhase', () => {
  it('open pool: create without a seat, lobby with one (or just submitted)', () => {
    expect(arenaPhase(pool('Open'), null, false, null)).toBe('create');
    expect(arenaPhase(pool('Open'), entry('me'), false, null)).toBe('lobby');
    expect(arenaPhase(pool('Open'), null, true, null)).toBe('lobby');
  });

  it('closed-but-unpublished pools are an honest sealing wait — never battle', () => {
    for (const s of ['Sealed', 'Scored', 'Paid'] as const) {
      expect(arenaPhase(pool(s), entry('me'), false, null)).toBe('sealing');
    }
  });

  it('published bundle: battle with a seat, spectate without', () => {
    expect(arenaPhase(pool('Scored'), entry('me'), false, BUNDLE)).toBe('battle');
    expect(arenaPhase(pool('Paid'), null, false, BUNDLE)).toBe('spectate');
  });

  it('terminal pool states are honest terminal phases', () => {
    expect(arenaPhase(pool('Refunding'), entry('me'), false, null)).toBe('refunding');
    expect(arenaPhase(pool('Closed'), null, false, null)).toBe('closed');
  });
});

describe('lobbyVisual', () => {
  it('carries seats sorted by idx, marks mine, and shortens wallets', () => {
    const v = lobbyVisual(
      pool('Open'),
      [entry('SomeVeryLongWalletAddressXYZ', 7), entry('MyOwnWalletAddress11111', 2)],
      'MyOwnWalletAddress11111'
    );
    expect(v.seats.map((s) => s.idx)).toEqual([2, 7]);
    expect(v.seats[0].mine).toBe(true);
    expect(v.seats[1].mine).toBe(false);
    expect(v.seats[1].playerShort).toBe('Some…sXYZ');
  });

  it('the projection carries no allocation, score or ranking field (sealing guarantee)', () => {
    const v = lobbyVisual(pool('Open'), [entry('a', 0)], null);
    const seatKeys = Object.keys(v.seats[0]).sort();
    expect(seatKeys).toEqual(['class', 'idx', 'mine', 'playerShort']);
    expect(Object.keys(v).sort()).toEqual(['entrants', 'fillDeadline', 'seats', 'state']);
  });
});
