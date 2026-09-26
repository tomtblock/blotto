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
import { MIN_SEATS, potForTier } from '../../../backend/scoring/src';

/** The minimum field, and the largest field that refunds, as small integers.
 * Read from the shared mirror of `constants.rs::MIN_SEATS` rather than typed:
 * these two cases ARE the boundary, so a literal here would go on asserting
 * the old rule against the new program. Rewritten 2026-09-13 for R7-b (the
 * founder instruction of 2026-09-12 §4, standing rule 0.7 — a test encoding a
 * replaced rule is rewritten in place, never deleted); they read 52 and 51
 * under D-E4. */
const MIN_FIELD = Number(MIN_SEATS);
const LARGEST_REFUNDING_FIELD = MIN_FIELD - 1;
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

  it('a pool at exactly the minimum field settles to Paid with the pot conserved', async function () {
    this.timeout(60_000);
    const pot = potForTier(0);
    const population = poolPopulation(77).slice(0, MIN_FIELD);
    const run = await runOfflinePool(77, { population });
    expect(run.outcome.finalState).to.equal('Paid');
    const pool = await run.chain.getPool(run.poolId);
    expect(pool.entrants).to.equal(MIN_FIELD);
    let total = 0n;
    for (const v of run.chain.paid.values()) total += v;
    for (const v of run.chain.escrowed.values()) total += v;
    expect(total, `conservation over ${MIN_FIELD} seats`).to.equal(pot);
    // The tree has one leaf per seat; the paid set is the rank-1 group.
    const bundle = run.publisher.published.get(run.outcome.bundleUri!)!;
    expect(bundle.results.length).to.equal(MIN_FIELD);
    for (const c of pool.payouts) {
      expect(c.entryIndex).to.be.below(MIN_FIELD);
      expect(bundle.results.find((r) => r.index === c.entryIndex)!.rank).to.equal(1);
    }
  });

  it('detection runs, reports, and blocks nobody — shadow mode (D-E9)', async () => {
    // WHAT THIS USED TO ASSERT (audit 2026-09-11, G-13). One entry's
    // `flagged` was false, under a title that said "shadow mode". Neither
    // half held up: the harness auto-flagged on hard blocks, which
    // production has never done, so nothing here was in shadow mode; and
    // seat 63's flag being false proved only that uniform timing is not a
    // hard-block signal — a detection pipeline that had silently stopped
    // running at all would have passed it identically.
    //
    // Shadow mode has two halves and both are asserted now: the signals FIRE
    // (there is a report, and it names the bot), and NOTHING acts on them
    // (no entry in the pool is flagged, and no share is escrowed).
    const run = await runOfflinePool(42);

    expect(run.detection.length, 'the crank asked for a report').to.equal(1);
    const report = run.detection[0];
    const bot = run.players[63]; // the scripted-timing strategy

    // Half one: the pipeline saw the bot. Uniform timing is a review
    // recommendation, not a hard block (R11) — so it must appear there and
    // must NOT appear in hardBlocks.
    expect(
      report.findings.length,
      'a 64-seat field of scripted strategies produces findings'
    ).to.be.greaterThan(0);
    expect(report.reviewRecommended, 'the bot is recommended for review').to.include(bot);
    expect(report.hardBlocks, 'uniform timing alone is never a hard block').to.not.include(bot);

    // Half two: nothing acted on any of it. Not the bot, not anyone.
    const entries = await run.chain.getEntries(run.poolId);
    expect(
      entries.filter((e) => e.flagged).map((e) => e.index),
      'a flag is a reviewer`s signed decision, never the daemon`s (D-E9)'
    ).to.deep.equal([]);
    expect(
      [...run.chain.escrowed.values()].filter((v) => v > 0n),
      'nothing escrowed, so the whole pot was paid out'
    ).to.deep.equal([]);
    let paid = 0n;
    for (const v of run.chain.paid.values()) paid += v;
    expect(paid, 'the pot reached wallets in full').to.equal(potForTier(0));
  });

  it('the refund fork drains a pool one seat under the minimum field, in full', async () => {
    // One below the floor is the largest field that refunds: at the floor the
    // pool seals and plays instead (the daemon specs cover that fork over the
    // same FakeChain). Both numbers derive from MIN_SEATS — see the note at
    // the top of this file.
    const chain = new FakeChain(() => 0n);
    const players = Array.from({ length: LARGEST_REFUNDING_FIELD }, (_, i) =>
      base58Encode(new Uint8Array(createHash('sha256').update(`r:${i}`).digest()))
    );
    chain.pools.set('9', {
      poolId: 9n,
      tier: 0,
      state: 'Refunding',
      resultsRootHex: null,
      vrfCommitted: true,
      entryLamports: 100_000_000n,
      potLamports: potForTier(0),
      fillDeadline: 0n,
      secretRevealed: false,
      resultsCommitted: false,
      mode: 0,
      paidMask: 0n,
      payouts: [],
      entrants: LARGEST_REFUNDING_FIELD,
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
    expect(total).to.equal(
      100_000_000n * BigInt(LARGEST_REFUNDING_FIELD),
      'every entry back in FULL, nothing withheld'
    );
  });
});
