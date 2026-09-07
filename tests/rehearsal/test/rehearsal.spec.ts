/**
 * The offline dress rehearsal (roadmap 5.1/5.2's semantics without a
 * cluster): twenty pools filled by the four-strategy population and settled
 * through the REAL crank + detection; the refund fork; conservation
 * reconciled on every pool. The devnet run repeats exactly this through
 * Web3Chain (docs/devnet-rehearsal.md).
 */
import { expect } from 'chai';
import { runOfflinePool } from '../src';
import { poolPopulation } from '../src/strategies';
import { potForTier } from '../../../backend/scoring/src';
import { FakeChain } from '../../../backend/reveal/src';
import { crankPool } from '../../../backend/reveal/src';
import { LocalCustody, MemoryCiphertextStore } from '../../../backend/sealing/src';
import { MemoryPublisher } from '../../../backend/reveal/src';
import { base58Encode } from '../../../backend/_shared/src/blotto-events';
import { createHash } from 'crypto';

describe('the offline dress rehearsal', () => {
  it('settles twenty pools cleanly with the pot conserved in every one', async function () {
    this.timeout(240_000);
    const pot = potForTier(0);
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
      // The paid set is exactly the rank-1 group (D-E2: one paid place; a
      // tie for first splits the pot), and every committed seat settled
      // exactly once.
      const pool = await run.chain.getPool(run.poolId);
      const winners = bundle.results.filter((r) => r.rank === 1).map((r) => r.index);
      expect(pool.payouts.map((c) => c.entryIndex), `pool ${p} paid set`).to.deep.equal(
        [...winners].sort((a, b) => a - b)
      );
      expect(pool.payouts.length).to.be.at.least(1);
      for (const c of pool.payouts) {
        expect((pool.paidMask >> BigInt(c.entryIndex)) & 1n, `seat ${c.entryIndex}`).to.equal(1n);
      }
    }
  });

  it('a 52-seat pool (the minimum field, D-E4) settles to Paid with the pot conserved', async function () {
    this.timeout(60_000);
    const pot = potForTier(0);
    const population = poolPopulation(77).slice(0, 52);
    const run = await runOfflinePool(77, { population });
    expect(run.outcome.finalState).to.equal('Paid');
    const pool = await run.chain.getPool(run.poolId);
    expect(pool.entrants).to.equal(52);
    let total = 0n;
    for (const v of run.chain.paid.values()) total += v;
    for (const v of run.chain.escrowed.values()) total += v;
    expect(total, 'conservation over 52 seats').to.equal(pot);
    // The tree has 52 leaves; the paid set is the rank-1 group.
    const bundle = run.publisher.published.get(run.outcome.bundleUri!)!;
    expect(bundle.results.length).to.equal(52);
    for (const c of pool.payouts) {
      expect(c.entryIndex).to.be.below(52);
      expect(bundle.results.find((r) => r.index === c.entryIndex)!.rank).to.equal(1);
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

  it('the refund fork drains a 51-entry pool in full (R7 as amended by D-E4)', async () => {
    // 51 is the largest field that refunds: at 52 the pool seals and plays
    // instead (the daemon specs cover that fork over the same FakeChain).
    const chain = new FakeChain(() => 0n);
    const players = Array.from({ length: 51 }, (_, i) =>
      base58Encode(new Uint8Array(createHash('sha256').update(`r:${i}`).digest()))
    );
    chain.pools.set('9', {
      poolId: 9n,
      tier: 0,
      state: 'Refunding',
      vrfCommitted: true,
      entryLamports: 100_000_000n,
      potLamports: potForTier(0),
      fillDeadline: 0n,
      secretRevealed: false,
      resultsCommitted: false,
      paidMask: 0n,
      payouts: [],
      entrants: 51,
    });
    chain.entries.set(
      '9',
      players.map((player, i) => ({
        player,
        index: i,
        battlesHash: '00'.repeat(32),
        flagged: false,
        refunded: false,
        settled: false,
        forfeited: false,
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
    expect(total).to.equal(100_000_000n * 51n, 'every entry back in FULL, nothing withheld');
  });
});
