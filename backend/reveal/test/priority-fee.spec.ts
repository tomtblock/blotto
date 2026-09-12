/*
 * The daemon's fee sampler (audit 2026-09-11, C-34): the shared percentile
 * choice fed from one cached RPC read, and the floor when the RPC is down.
 */
import { expect } from 'chai';
import { PROVISIONAL_PRIORITY_FEE_FLOOR_MICROLAMPORTS } from '../../_shared/src/priority-fee';
import { makePriorityFeeSampler } from '../src/priority-fee';

describe('the priority-fee sampler', () => {
  it('bids the 75th percentile of the non-zero samples (four samples: the top one), from one read per cache window', async () => {
    let calls = 0;
    let t = 0;
    const sampler = makePriorityFeeSampler(
      {
        getRecentPrioritizationFees: async () => {
          calls++;
          return [0, 0, 5_000, 10_000, 20_000, 40_000].map((prioritizationFee) => ({ prioritizationFee }));
        },
      },
      { cacheMs: 30_000, nowMs: () => t }
    );
    expect(await sampler()).to.equal(40_000n);
    expect(await sampler()).to.equal(40_000n);
    expect(calls).to.equal(1, 'a tick that sends several transactions asks once');
    t = 30_000;
    expect(await sampler()).to.equal(40_000n);
    expect(calls).to.equal(2, 'a new window asks again');
  });

  it('falls to the floor on a quiet cluster and when the RPC will not answer, never zero', async () => {
    const quiet = makePriorityFeeSampler({
      getRecentPrioritizationFees: async () => [{ prioritizationFee: 0 }, { prioritizationFee: 0 }],
    });
    expect(await quiet()).to.equal(PROVISIONAL_PRIORITY_FEE_FLOOR_MICROLAMPORTS);
    const down = makePriorityFeeSampler({
      getRecentPrioritizationFees: async () => {
        throw new Error('rpc down');
      },
    });
    expect(await down()).to.equal(PROVISIONAL_PRIORITY_FEE_FLOOR_MICROLAMPORTS);
  });
});
