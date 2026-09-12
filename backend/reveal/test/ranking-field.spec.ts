/**
 * `recomputeRanking` refuses an incomplete field (audit 2026-09-11, B-09).
 *
 * The next-place driver recomputes the ranking from the entry accounts it
 * read; a program-account scan that came back short would otherwise be
 * ranked as if the missing seats never existed. The refusal happens before
 * the store or the secret is touched, so this needs neither.
 */

import { expect } from 'chai';
import { recomputeRanking } from '../src/ranking';
import type { CiphertextStore } from '../../sealing/src';

const untouched: CiphertextStore = {
  get: async () => {
    throw new Error('the store must not be read for an incomplete field');
  },
  put: async () => {
    throw new Error('never');
  },
  list: async () => {
    throw new Error('never');
  },
} as unknown as CiphertextStore;

describe('recomputeRanking against a short field', () => {
  it('refuses when fewer entry accounts were read than the pool reports', async () => {
    let threw: unknown = null;
    try {
      await recomputeRanking(untouched, 7n, new Uint8Array(32), [], 64, 4_000_000_000n, null);
    } catch (e) {
      threw = e;
    }
    expect(threw).to.be.instanceOf(Error);
    expect((threw as Error).message).to.match(/64 entrants/);
    expect((threw as Error).message).to.match(/incomplete field/);
  });
});
