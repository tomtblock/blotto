/**
 * The offline dress rehearsal (roadmap 5.1/5.2's semantics without a
 * cluster): twenty pools filled by the four-strategy population and settled
 * through the REAL crank + detection; the refund fork; conservation
 * reconciled on every pool. Since the Ladder (D-E19) the twenty pools cycle
 * through the four pool sizes — five of each — and every one is checked to
 * have paid ITS OWN table: the amounts re-derived from the published scores
 * with `assignPrizes` over the table read back off the pool. The devnet run
 * repeats exactly this through Web3Chain (docs/guide/DEVNET-REHEARSAL.md).
 */
import { expect } from 'chai';
import { createHash } from 'crypto';
import { offlineChain, offlinePoolTerms, runOfflinePool, type OfflinePoolRun } from '../src';
import { poolPopulation } from '../src/strategies';
import {
  POOL_CAPACITIES,
  assignPrizes,
  assignRanks,
  ladderTable,
  minFieldFor,
  prizeTableFromChain,
  type PoolCapacity,
} from '../../../backend/scoring/src';
import { MemoryPublisher, crankPool } from '../../../backend/reveal/src';
import { LocalCustody, MemoryCiphertextStore } from '../../../backend/sealing/src';
import { base58Encode } from '../../../backend/_shared/src/blotto-events';

/*
 * The minimum field, and the largest field that refunds, per pool size.
 * Read from the shared mirror of `constants.rs::LADDER_MIN_SEATS`
 * (`minFieldFor`) rather than typed: these cases ARE the boundary, so a
 * literal here would go on asserting the old rule against the new program.
 * Rewritten 2026-09-13 for R7-b and again 2026-11-05 for D-E19 (standing
 * rule 0.7 — a test encoding a replaced rule is rewritten in place, never
 * deleted); under R7-b they read 40 and 39 for the one 64-player pool.
 */
const largestRefundingField = (capacity: PoolCapacity) => minFieldFor(capacity) - 1;

/**
 * Everything a settled pool must satisfy under the Ladder, from the pool's
 * OWN terms: it opened with its size's table, minimum field and prize pool;
 * paid + escrowed equals the prize pool to the lamport; the committed list
 * is exactly what `assignPrizes` pays over the table read back off the pool
 * (D3-B ties included); every committed seat settled once; the bundle names
 * the root and the terms.
 */
async function expectSettledOnOwnTable(run: OfflinePoolRun, capacity: PoolCapacity, label: string) {
  expect(run.outcome.finalState, label).to.equal('Paid');
  const pool = await run.chain.getPool(run.poolId);
  const terms = offlinePoolTerms(capacity);

  // Opened on its size's terms.
  expect(pool.capacity, `${label} capacity`).to.equal(capacity);
  expect(pool.minSeats, `${label} minimum field`).to.equal(minFieldFor(capacity));
  const table = prizeTableFromChain(pool.prizeTable, pool.paidPlaces);
  expect(table, `${label} table`).to.deep.equal([...ladderTable(capacity)]);
  expect(pool.potLamports, `${label} prize pool`).to.equal(terms.potLamports);

  // Conservation: paid + escrowed == the prize pool, to the lamport.
  let total = 0n;
  for (const v of run.chain.paid.values()) total += v;
  for (const v of run.chain.escrowed.values()) total += v;
  expect(total, `${label} conservation`).to.equal(pool.potLamports);

  // The published bundle carries the committed root and the pool's terms.
  const bundle = run.publisher.published.get(run.outcome.bundleUri!)!;
  expect(bundle.results_root).to.equal(
    Buffer.from(run.chain.committedRoots.get(run.poolId.toString())!).toString('hex')
  );
  const v4 = bundle as unknown as {
    version: number;
    capacity: number;
    paid_places: number;
    prize_table: number[];
    min_seats: number;
  };
  expect(v4.version, `${label} bundle version`).to.equal(4);
  expect(v4.capacity).to.equal(capacity);
  expect(v4.paid_places).to.equal(table.length);
  expect(v4.prize_table).to.deep.equal(table);
  expect(v4.min_seats).to.equal(minFieldFor(capacity));

  // The committed list IS assignPrizes over the pool's own table, recomputed
  // from the published scores alone — what a player's recomputation does.
  const expected = assignPrizes(
    assignRanks(bundle.results.map((r) => ({ index: r.index, scoreHalf: r.score_half, zones: r.zones }))),
    table,
    pool.entryLamports
  );
  const expectedPayouts = expected
    .filter((r) => r.amountLamports > 0n)
    .sort((a, b) => a.index - b.index)
    .map((r) => ({ entryIndex: r.index, amountLamports: r.amountLamports }));
  expect(pool.payouts, `${label} committed list`).to.deep.equal(expectedPayouts);
  for (const r of expected) {
    const published = bundle.results.find((b) => b.index === r.index)!;
    expect(BigInt(published.amount_lamports), `${label} seat ${r.index}`).to.equal(r.amountLamports);
    const reached =
      (run.chain.paid.get(run.players[r.index]) ?? 0n) + (run.chain.escrowed.get(run.players[r.index]) ?? 0n);
    expect(reached, `${label} seat ${r.index} received`).to.equal(r.amountLamports);
  }

  // Ties can only widen the paid set past the table, never narrow it.
  expect(pool.payouts.length).to.be.at.least(Math.min(table.length, pool.entrants));
  for (const c of pool.payouts) {
    expect((pool.paidMask >> BigInt(c.entryIndex)) & 1n, `${label} seat ${c.entryIndex}`).to.equal(1n);
  }
}

describe('the offline dress rehearsal', () => {
  it('settles twenty pools across the four sizes, each on its own table, the prize pool conserved', async function () {
    this.timeout(240_000);
    const seen = new Map<number, number>();
    for (let p = 1; p <= 20; p++) {
      const capacity = POOL_CAPACITIES[(p - 1) % POOL_CAPACITIES.length];
      const run = await runOfflinePool(p, { population: poolPopulation(p, capacity), capacity });
      const pool = await run.chain.getPool(run.poolId);
      expect(pool.entrants, `pool ${p} full`).to.equal(capacity);
      await expectSettledOnOwnTable(run, capacity, `pool ${p} (${capacity})`);
      seen.set(capacity, (seen.get(capacity) ?? 0) + 1);
    }
    // Five pools of every size.
    expect([...seen.entries()].sort((a, b) => a[0] - b[0])).to.deep.equal(
      POOL_CAPACITIES.map((c) => [c, 5])
    );
  });

  for (const capacity of POOL_CAPACITIES) {
    it(`a pool of ${capacity} at exactly its minimum field settles on its full table`, async function () {
      this.timeout(60_000);
      const field = minFieldFor(capacity);
      const population = poolPopulation(77 + capacity, capacity).slice(0, field);
      const run = await runOfflinePool(77 + capacity, { population, capacity });
      const pool = await run.chain.getPool(run.poolId);
      expect(pool.entrants).to.equal(field);
      // The table depends on the size alone (D-E19): a pool that seals at its
      // floor pays the same places, and the same prize pool, as a full one.
      await expectSettledOnOwnTable(run, capacity, `${field} of ${capacity}`);
      const bundle = run.publisher.published.get(run.outcome.bundleUri!)!;
      expect(bundle.results.length).to.equal(field);
      for (const c of pool.payouts) expect(c.entryIndex).to.be.below(field);
    });
  }

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
      'nothing escrowed, so the whole prize pool was paid out'
    ).to.deep.equal([]);
    let paid = 0n;
    for (const v of run.chain.paid.values()) paid += v;
    expect(paid, 'the prize pool reached wallets in full').to.equal(offlinePoolTerms(64).potLamports);
  });

  for (const capacity of POOL_CAPACITIES) {
    it(`the refund fork drains a pool of ${capacity} one entrant under its minimum field, in full`, async () => {
      // One below the floor is the largest field that refunds: at the floor
      // the pool seals and plays instead (the daemon specs cover that fork
      // over the same FakeChain). Both numbers derive from the size's
      // minimum field — see the note at the top of this file.
      const field = largestRefundingField(capacity);
      const terms = offlinePoolTerms(capacity);
      const chain = await offlineChain(() => 0n);
      // `trigger_refund` and `refund` name the pool's type (D-E19).
      chain.addPoolType(0, 0, capacity);
      const players = Array.from({ length: field }, (_, i) =>
        base58Encode(new Uint8Array(createHash('sha256').update(`r:${capacity}:${i}`).digest()))
      );
      chain.pools.set('9', {
        poolId: 9n,
        tier: 0,
        state: 'Refunding',
        resultsRootHex: null,
        vrfCommitted: true,
        entryLamports: 100_000_000n,
        potLamports: terms.potLamports,
        fillDeadline: 0n,
        secretRevealed: false,
        resultsCommitted: false,
        mode: 0,
        paidMask: 0n,
        payouts: [],
        entrants: field,
        capacity: terms.capacity,
        minSeats: terms.minSeats,
        paidPlaces: terms.paidPlaces,
        prizeTable: terms.prizeTable,
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
        100_000_000n * BigInt(field),
        'every entry back in FULL, nothing withheld'
      );
    });
  }
});
