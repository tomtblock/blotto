/**
 * The offline dress rehearsal (roadmap 5.1/5.2's semantics without a
 * cluster): twenty pools filled by the four-strategy population and settled
 * through the REAL crank + detection; the refund fork; conservation
 * reconciled on every pool. The devnet run repeats exactly this through
 * Web3Chain (docs/devnet-rehearsal.md).
 */
import { expect } from 'chai';
import { runOfflinePool } from '../src';
import { potLamports } from '../../../backend/scoring/src';
import { FakeChain } from '../../../backend/reveal/src';
import { crankPool } from '../../../backend/reveal/src';
import { LocalCustody, MemoryCiphertextStore } from '../../../backend/sealing/src';
import { MemoryPublisher } from '../../../backend/reveal/src';
import { base58Encode } from '../../../backend/_shared/src/blotto-events';
import { createHash } from 'crypto';

describe('the offline dress rehearsal', () => {
  it('settles twenty pools cleanly with the pot conserved in every one', async function () {
    this.timeout(240_000);
    const pot = potLamports(100_000_000n);
    for (let p = 1; p <= 20; p++) {
      const run = await runOfflinePool(p);
      expect(run.outcome.finalState, `pool ${p}`).to.equal('Paid');
      // Conservation: paid + escrowed == pot, to the lamport.
      let total = 0n;
      for (const v of run.chain.paid.values()) total += v;
      for (const v of run.chain.escrowed.values()) total += v;
      expect(total, `pool ${p} conservation`).to.equal(pot);
      // The published bundle carries the committed root.
      const bundle = run.publisher.published.get(run.outcome.bundleUri!)!;
      expect(bundle.results_root).to.equal(
        Buffer.from(run.chain.committedRoots.get(run.poolId.toString())!).toString('hex')
      );
      // Every committed seat settled exactly once (D3-B: the paid set can
      // exceed 16 seats when a tie straddles position 16).
      const pool = await run.chain.getPool(run.poolId);
      expect(pool.payouts.length).to.be.at.least(16);
      for (const c of pool.payouts) {
        expect((pool.paidMask >> BigInt(c.entryIndex)) & 1n, `seat ${c.entryIndex}`).to.equal(1n);
      }
    }
  });

  it('detection notes the scripted bot in shadow mode without blocking it', async () => {
    const run = await runOfflinePool(42);
    // Strategy seat 63 is the bot. It must have been PAYABLE (no hard block —
    // uniform timing alone is not a hard-block signal, R11).
    const bot = run.players[63];
    const flagged = (await run.chain.getEntries(run.poolId)).find((e) => e.player === bot)!;
    expect(flagged.flagged).to.equal(false);
  });

  it('the refund fork drains a 63-entry pool in full (R7)', async () => {
    const chain = new FakeChain(() => 0n);
    const players = Array.from({ length: 63 }, (_, i) =>
      base58Encode(new Uint8Array(createHash('sha256').update(`r:${i}`).digest()))
    );
    chain.pools.set('9', {
      poolId: 9n,
      tier: 0,
      state: 'Refunding',
      vrfCommitted: true,
      entryLamports: 100_000_000n,
      fillDeadline: 0n,
      secretRevealed: false,
      resultsCommitted: false,
      paidMask: 0n,
      payouts: [],
      entrants: 63,
    });
    chain.entries.set(
      '9',
      players.map((player, i) => ({
        player,
        index: i,
        battlesHash: '00'.repeat(32),
        flagged: false,
        refunded: false,
      }))
    );
    const outcome = await crankPool(
      {
        chain,
        custody: new LocalCustody(async () => false),
        ciphertexts: new MemoryCiphertextStore(),
        publisher: new MemoryPublisher(),
      },
      9n
    );
    expect(outcome.finalState).to.equal('Closed');
    let total = 0n;
    for (const v of chain.paid.values()) total += v;
    expect(total).to.equal(100_000_000n * 63n, 'every entry back in FULL, 20% included');
  });
});
