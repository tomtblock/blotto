/* C9: the balance pre-flight is fail-closed and boundary-exact. */
import { describe, expect, it } from 'vitest';
import { ENTRY_COST_HEADROOM_LAMPORTS, checkBalanceGate } from './balance-gate';

const ENTRY = 100_000_000n;
const NEED = ENTRY + ENTRY_COST_HEADROOM_LAMPORTS;

describe('checkBalanceGate', () => {
  it('passes exactly at entry + headroom, not one lamport below', async () => {
    const at = await checkBalanceGate(async () => NEED, 'w', ENTRY);
    expect(at).toEqual({ state: 'ok', haveLamports: NEED });
    const below = await checkBalanceGate(async () => NEED - 1n, 'w', ENTRY);
    expect(below).toEqual({
      state: 'insufficient',
      needLamports: NEED,
      haveLamports: NEED - 1n,
    });
  });

  it('an unreadable balance blocks — never waves through', async () => {
    const got = await checkBalanceGate(
      async () => {
        throw new Error('rpc down');
      },
      'w',
      ENTRY
    );
    expect(got).toEqual({ state: 'unavailable' });
  });
});
