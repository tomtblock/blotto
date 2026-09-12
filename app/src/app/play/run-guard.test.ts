/*
 * C-17 / D-13 (audit 2026-09-11): a transient wallet or active-address
 * change during the run unmounted the battle flow and discarded all seven
 * allocations with no message.
 *
 * The rule the page now reads. The cases that matter are the ones a
 * reconnect actually produces: the seam going back to "initializing", the
 * address briefly reading null, the same address arriving again from a
 * different source. None of those is a change of account, and none of them
 * may cost a player their ninety seconds.
 */
import { describe, expect, it } from 'vitest';
import { runInterruption } from './run-guard';

const A = 'W411etAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const B = 'W411etBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

describe('runInterruption', () => {
  it('leaves the pre-flight gates alone when no run has begun', () => {
    expect(runInterruption(null, { status: 'signed-in', walletAddress: A })).toBe('none');
    expect(runInterruption(null, { status: 'signed-out', walletAddress: null })).toBe('none');
  });

  it('HOLDS the run through every shape of a reconnect', () => {
    // The finding, case by case: each of these used to unmount the flow.
    const reconnects: Array<{ status: string; walletAddress: string | null }> = [
      { status: 'signed-in', walletAddress: A }, // steady state
      { status: 'signed-in', walletAddress: null }, // address not resolved yet
      { status: 'initializing', walletAddress: null }, // the provider re-reading
      { status: 'initializing', walletAddress: A },
      { status: 'signed-out', walletAddress: null }, // a momentary drop
    ];
    for (const auth of reconnects) {
      expect(runInterruption(A, auth), JSON.stringify(auth)).toBe('transient');
    }
  });

  it('stops the run ONLY for a signed-in, named, different account', () => {
    expect(runInterruption(A, { status: 'signed-in', walletAddress: B })).toBe('account-changed');
  });

  it('does not treat a different address as a change while signed out', () => {
    // A stale address reported by a seam that is not signed in cannot
    // contradict the run: it is not an assertion about who is playing.
    expect(runInterruption(A, { status: 'initializing', walletAddress: B })).toBe('transient');
    expect(runInterruption(A, { status: 'signed-out', walletAddress: B })).toBe('transient');
  });
});
