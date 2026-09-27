import { describe, expect, it } from 'vitest';
import { COPY } from '@/copy';
import { poolStateLabel } from './pool-state-label';

describe('poolStateLabel (Stage C)', () => {
  it('reads the derived resolving flag before the on-chain state', () => {
    expect(poolStateLabel({ state: 'Paid', resolving: true })).toBe(COPY.pool.resolving);
    expect(poolStateLabel({ state: 'Scored', resolving: true })).toBe(COPY.pool.resolving);
  });

  it('calls an open pool "Open now" — the one word set for the state everywhere (V2)', () => {
    expect(poolStateLabel({ state: 'Open', resolving: false })).toBe(COPY.pool.stateOpen);
    expect(poolStateLabel({ state: 'Open' })).toBe(COPY.pool.stateOpen);
  });

  it('otherwise shows the on-chain state as the projection wrote it', () => {
    for (const state of ['Sealed', 'Scored', 'Paid', 'Refunding', 'Closed'] as const) {
      expect(poolStateLabel({ state, resolving: false })).toBe(state);
      // A row from a read API that predates the field still labels.
      expect(poolStateLabel({ state })).toBe(state);
    }
  });
});
