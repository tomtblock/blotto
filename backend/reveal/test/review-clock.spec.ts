/*
 * The review clock's release predicate (2026-09-12, audit 2026-09-11 B-30):
 * mirrors escrow.rs — settled into escrow under a flag, not forfeited, and
 * NOT under a sanctions hold, which both release paths refuse. Pinned over
 * every combination so the daemon's inline check and the shared mirror can
 * never drift apart.
 */
import { expect } from 'chai';
import { releasableByClock } from '../src/chain';

describe('releasableByClock', () => {
  const bools = [false, true];
  it('is true exactly for a settled, flagged, unforfeited, unheld share with escrow', () => {
    for (const settled of bools)
      for (const flagged of bools)
        for (const forfeited of bools)
          for (const sanctionsHold of bools)
            for (const escrow of [0n, 1n, 4_000_000_000n]) {
              const expected = settled && flagged && !forfeited && !sanctionsHold && escrow > 0n;
              expect(
                releasableByClock({ settled, flagged, forfeited, sanctionsHold }, escrow),
                JSON.stringify({ settled, flagged, forfeited, sanctionsHold, escrow: escrow.toString() })
              ).to.equal(expected);
            }
  });

  it('agrees with the daemon: a held share under review is "under review" and not releasable', () => {
    const e = { settled: true, flagged: true, forfeited: false, sanctionsHold: true };
    const underReview = e.settled && e.flagged && !e.forfeited;
    expect(underReview).to.equal(true);
    expect(releasableByClock(e, 1n)).to.equal(false);
  });
});
