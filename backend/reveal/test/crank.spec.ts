/**
 * Crank specs (roadmap 2.4), offline: FakeChain mirrors the program's state
 * machine, LocalCustody enforces the export policy, MemoryPublisher captures
 * the bundle. The devnet run of the same crank is the Phase 5 rehearsal.
 */
import { expect } from 'chai';
import { createHash } from 'crypto';
import { ALERT } from '../../_shared/src/metrics';
import { short } from '../../_shared/src/short';
import {
  crankPool,
  publishBundle,
  FakeChain,
  MemoryPublisher,
  MemoryPublishedBundleStore,
  scoreWithMissing,
  type FakeEntry,
  type RevealedForDetection,
} from '../src';
import {
  LocalCustody,
  MemoryCiphertextStore,
  encodePayload,
  seal,
  type SealedPayload,
} from '../../sealing/src';
import {
  assignPrizes,
  battlesHash,
  potForTier,
  scorePool,
  type BattleSet,
} from '../../scoring/src';
import { base58Encode } from '../../_shared/src/blotto-events';

const sha = (s: string) => new Uint8Array(createHash('sha256').update(s).digest());
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

/** Deterministic valid allocation stream (same construction as the oracle). */
function alloc(i: number): number[] {
  const h = sha(`alloc:${i}`);
  const d = [0, 1, 2, 3].map((k) => (h[k * 2] | (h[k * 2 + 1] << 8)) % 101).sort((a, b) => a - b);
  return [d[0], d[1] - d[0], d[2] - d[1], d[3] - d[2], 100 - d[3]];
}
function battlesFor(base: number): BattleSet {
  return Array.from({ length: 7 }, (_, k) => alloc(base + k)) as never;
}

interface TestPool {
  chain: FakeChain;
  custody: LocalCustody;
  store: MemoryCiphertextStore;
  publisher: MemoryPublisher;
  players: string[];
  battles: BattleSet[];
}

async function buildSealedPool(sabotage: {
  missing?: number;
  garbage?: number;
  hashMismatch?: number;
}): Promise<TestPool> {
  const chain = new FakeChain();
  const custody = new LocalCustody(async (id) => {
    const p = await chain.getPool(id);
    return p.state !== 'Open';
  });
  const store = new MemoryCiphertextStore();
  const publisher = new MemoryPublisher();

  const { publicKey } = await custody.createPoolKey(1n);
  const players: string[] = [];
  const battles: BattleSet[] = [];
  const entries: FakeEntry[] = [];

  for (let i = 0; i < 64; i++) {
    const player = base58Encode(sha(`player:${i}`));
    players.push(player);
    const b = battlesFor(i * 100);
    battles.push(b);
    const payload: SealedPayload = {
      battles: b,
      salt: sha(`salt:${i}`),
      timingsMs: [1000, 2000, 3000, 4000, 5000, 6000, 7000],
      deviceHash: sha(`device:${i}`),
    };
    const onChainHash =
      sabotage.hashMismatch === i
        ? hex(sha(`wrong:${i}`))
        : hex(battlesHash(b, payload.salt));
    entries.push({
      player,
      index: i,
      battlesHash: onChainHash,
      flagged: false,
      refunded: false,
      settled: false,
      forfeited: false,
    });
    if (sabotage.missing === i) continue; // never stored
    if (sabotage.garbage === i) {
      await store.put(1n, player, sha(`garbage:${i}`)); // not a sealed box
    } else {
      await store.put(1n, player, seal(encodePayload(payload), publicKey));
    }
  }

  chain.pools.set('1', {
    poolId: 1n,
    tier: 0,
    state: 'Sealed',
      resultsRootHex: null,
    vrfCommitted: true,
    entryLamports: 100_000_000n,
    potLamports: potForTier(0),
    fillDeadline: 0n,
    secretRevealed: false,
    resultsCommitted: false,
    paidMask: 0n,
    payouts: [],
    entrants: 64,
  });
  chain.entries.set('1', entries);
  return { chain, custody, store, publisher, players, battles };
}

describe('the settlement crank', () => {
  it('does not turn a screening outage into an on-chain hold', async function () {
    this.timeout(30000);
    const t = await buildSealedPool({});
    const deps = {
      chain: t.chain,
      custody: t.custody,
      ciphertexts: t.store,
      publisher: t.publisher,
      // Every source down: the composite throws, which the screener
      // converts into `screening_unavailable`.
      screenWinners: async (_poolId: bigint, winners: readonly string[]) =>
        winners.map((player) => ({
          player,
          reason: 'screening_unavailable' as const,
          matches: [],
          error: 'every source failed',
        })),
    };

    let threw: Error | null = null;
    try {
      await crankPool(deps as never, 1n);
    } catch (e) {
      threw = e as Error;
    }
    expect(threw, 'an outage must not be recorded as a verdict').to.not.equal(null);
    expect(threw!.message).to.match(/could not answer/);

    // Nothing on chain: no hold to lift, no escrow to chase, nothing paid.
    const pool = await t.chain.getPool(1n);
    expect(pool.resultsCommitted).to.equal(false);
    expect(pool.paidMask).to.equal(0n);
    const entries = await t.chain.getEntries(1n);
    expect(entries.some((e) => e.sanctionsHold)).to.equal(false);
  });

  it('still places a hold when a winner actually matches a list', async function () {
    this.timeout(30000);
    const t = await buildSealedPool({});
    let holdsPlaced = 0;
    const deps = {
      chain: t.chain,
      custody: t.custody,
      ciphertexts: t.store,
      publisher: t.publisher,
      screenWinners: async (_poolId: bigint, winners: readonly string[]) => {
        holdsPlaced = 1;
        return [
          {
            player: winners[0],
            reason: 'listed' as const,
            matches: [{ source: 'ofac', listName: 'SDN' }],
          },
        ];
      },
    };

    const outcome = await crankPool(deps as never, 1n);
    expect(holdsPlaced).to.equal(1);
    expect(outcome.stepsTaken).to.include('place_sanctions_hold');
  });

  it('pays the pool even when publishing keeps failing', async function () {
    this.timeout(30000);
    const t = await buildSealedPool({});
    // An unfunded upload wallet or a gateway outage: publishing never works.
    const failing = {
      publish: async () => {
        throw new Error('irys unavailable');
      },
      published: new Map(),
    };

    const outcome = await crankPool(
      {
        chain: t.chain,
        custody: t.custody,
        ciphertexts: t.store,
        publisher: failing as never,
      },
      1n
    );

    // The players are paid and the tier is free. That is the whole point:
    // a storage vendor must not be able to strand a pot.
    expect(outcome.finalState).to.equal('Paid');
    expect(outcome.stepsTaken).to.include('publish-failed');
    expect(outcome.bundleUri).to.equal(undefined);
    const pool = await t.chain.getPool(1n);
    expect(pool.paidMask).to.not.equal(0n);
  });

  it('refuses to settle when it read fewer Entry accounts than the pool reports', async function () {
    this.timeout(30000);
    const t = await buildSealedPool({});
    // The Pool account and the Entry accounts are separate reads. Model a
    // backend a slot behind on the second: the highest seat is missing, so
    // the remaining entries are still gapless from zero and every
    // downstream check would pass.
    const short = t.chain.entries.get('1')!.slice(0, -1);
    t.chain.entries.set('1', short);

    const deps = {
      chain: t.chain,
      custody: t.custody,
      ciphertexts: t.store,
      publisher: t.publisher,
    };
    let threw: Error | null = null;
    try {
      await crankPool(deps, 1n);
    } catch (e) {
      threw = e as Error;
    }
    expect(threw, 'the crank must refuse an incomplete field').to.not.equal(null);
    expect(threw!.message).to.match(/incomplete field/);
    // Nothing was committed and nothing was paid: waiting is the fix.
    const pool = await t.chain.getPool(1n);
    expect(pool.resultsCommitted).to.equal(false);
    expect(pool.paidMask).to.equal(0n);
  });

  it('refuses to settle a field in which nothing could be read back', async function () {
    this.timeout(30000);
    const t = await buildSealedPool({});
    // Model the ciphertext table having been lost: every entry decrypts to
    // nothing. The arithmetic is untroubled — every seat ties on zero and
    // the pot divides evenly — which is exactly why this needs a guard.
    for (const e of t.chain.entries.get('1')!) {
      await t.store.put(1n, e.player, new Uint8Array(48 + 127));
    }

    const deps = {
      chain: t.chain,
      custody: t.custody,
      ciphertexts: t.store,
      publisher: t.publisher,
    };
    let threw: Error | null = null;
    try {
      await crankPool(deps, 1n);
    } catch (e) {
      threw = e as Error;
    }
    expect(threw, 'the crank must refuse a wholly unreadable field').to.not.equal(null);
    expect(threw!.message).to.match(/could not be read back/);
    const pool = await t.chain.getPool(1n);
    expect(pool.resultsCommitted).to.equal(false);
    expect(pool.paidMask).to.equal(0n);
  });

  it('drives a sealed pool to Paid with every band exact', async function () {
    this.timeout(30000);
    const t = await buildSealedPool({});
    const outcome = await crankPool(
      { chain: t.chain, custody: t.custody, ciphertexts: t.store, publisher: t.publisher },
      1n
    );
    expect(outcome.finalState).to.equal('Paid');
    expect(outcome.bundleUri).to.be.a('string');

    // The bundle's ranking and amounts equal the pure engine's (with the
    // D3-B split-pot assignment) over the same battles.
    const bundle = t.publisher.published.get(outcome.bundleUri!)!;
    const pot = potForTier(0);
    const engine = assignPrizes(scorePool(t.battles), pot);
    for (const r of bundle.results) {
      const e = engine[r.index];
      expect(r.score_half).to.equal(e.scoreHalf);
      expect(r.rank).to.equal(e.rank);
      expect(r.amount_lamports).to.equal(e.amountLamports.toString());
    }
    expect(bundle.scored_as_all_losses).to.deep.equal([]);
    expect(bundle.results_root).to.equal(hex(t.chain.committedRoots.get('1')!));

    // The committed set is exactly the rank-1 group (D-E2: one paid place,
    // a tie for first splits the pot); every committed seat got exactly
    // its split-pot amount; total = pot.
    const committed = (await t.chain.getPool(1n)).payouts;
    const winners = engine.filter((r) => r.rank === 1).map((r) => r.index);
    expect(committed.map((c) => c.entryIndex)).to.deep.equal(winners);
    expect(engine.filter((r) => r.rank > 1).every((r) => r.amountLamports === 0n)).to.equal(true);
    for (const c of committed) {
      expect(t.chain.paid.get(t.players[c.entryIndex])).to.equal(c.amountLamports);
      expect(c.amountLamports).to.equal(engine[c.entryIndex].amountLamports);
    }
    let total = 0n;
    for (const v of t.chain.paid.values()) total += v;
    expect(total).to.equal(pot);
  });

  it('is idempotent: a second run over a Paid pool changes nothing', async function () {
    this.timeout(30000);
    const t = await buildSealedPool({});
    const deps = { chain: t.chain, custody: t.custody, ciphertexts: t.store, publisher: t.publisher };
    await crankPool(deps, 1n);
    const paidBefore = new Map(t.chain.paid);
    const second = await crankPool(deps, 1n);
    expect(second.finalState).to.equal('Paid');
    expect(second.stepsTaken).to.include('reveal:already');
    expect(second.stepsTaken).to.include('commit:already');
    expect(second.stepsTaken.filter((s) => s === 'pay_prizes')).to.deep.equal([]);
    expect(t.chain.paid).to.deep.equal(paidBefore);
  });

  it('resumes from a partially paid pool without double-paying', async function () {
    this.timeout(30000);
    const t = await buildSealedPool({});
    const deps = { chain: t.chain, custody: t.custody, ciphertexts: t.store, publisher: t.publisher };

    // First run, but the RPC dies AFTER the first pay batch landed and
    // before its confirmation came back — the crash window that tempts a
    // resumed crank into paying the same seats again. (Under D-E2 the paid
    // set is usually one batch, so the crash has to sit after the landing,
    // not between batches.)
    const original = t.chain.payPrizes.bind(t.chain);
    let batches = 0;
    t.chain.payPrizes = async (poolId, seats) => {
      await original(poolId, seats);
      if (batches++ === 0) throw new Error('rpc died after the batch landed');
    };
    let failed = false;
    try {
      await crankPool(deps, 1n);
    } catch {
      failed = true;
    }
    expect(failed).to.equal(true);
    t.chain.payPrizes = original;

    const resumed = await crankPool(deps, 1n);
    expect(resumed.finalState).to.equal('Paid');
    const pot = potForTier(0);
    let total = 0n;
    for (const v of t.chain.paid.values()) total += v;
    expect(total).to.equal(pot, 'no seat paid twice, none skipped');
  });

  it('scores lost, garbage and mismatched ciphertexts as all losses and publishes them', async function () {
    this.timeout(30000);
    const t = await buildSealedPool({ missing: 3, garbage: 7, hashMismatch: 11 });
    const deps = { chain: t.chain, custody: t.custody, ciphertexts: t.store, publisher: t.publisher };
    const outcome = await crankPool(deps, 1n);
    expect(outcome.finalState).to.equal('Paid');
    const bundle = t.publisher.published.get(outcome.bundleUri!)!;
    expect(bundle.scored_as_all_losses.sort()).to.deep.equal(
      [t.players[3], t.players[7], t.players[11]].sort()
    );
    const statuses = new Map(bundle.entries.map((e) => [e.index, e.status]));
    expect(statuses.get(3)).to.equal('missing_ciphertext');
    expect(statuses.get(7)).to.equal('decrypt_failed');
    expect(statuses.get(11)).to.equal('hash_mismatch');
    // The three sit at the very bottom of the ranking.
    const bottom = bundle.results.filter((r) => r.rank > 61).map((r) => r.index).sort((a, b) => a - b);
    expect(bottom).to.deep.equal([3, 7, 11]);
  });

  it('drains a Refunding pool', async () => {
    const chain = new FakeChain();
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
      paidMask: 0n,
      payouts: [],
      entrants: 3,
    });
    chain.entries.set(
      '9',
      [0, 1, 2].map((i) => ({
        player: base58Encode(sha(`r:${i}`)),
        index: i,
        battlesHash: '00'.repeat(32),
        flagged: false,
        refunded: false,
        settled: false,
        forfeited: false,
      }))
    );
    const custody = new LocalCustody(async () => false);
    const outcome = await crankPool(
      {
        chain,
        custody,
        ciphertexts: new MemoryCiphertextStore(),
        publisher: new MemoryPublisher(),
      },
      9n
    );
    expect(outcome.finalState).to.equal('Closed');
    let total = 0n;
    for (const v of chain.paid.values()) total += v;
    expect(total).to.equal(300_000_000n, 'R7: full entry back, all three');
  });
});

describe('scoring with missing entries (the published all-losses rule)', () => {
  it('shifts every present player uniformly — relative order preserved', () => {
    const battles = Array.from({ length: 6 }, (_, i) => battlesFor(i * 1000));
    const pure = scorePool(battles);
    const withMissing = scoreWithMissing([
      ...battles.map((b, i) => ({ index: i, battles: b })),
      { index: 6, battles: null },
      { index: 7, battles: null },
    ]);
    for (let i = 0; i < 6; i++) {
      expect(withMissing[i].scoreHalf).to.equal(pure[i].scoreHalf + 2 * 7 * 2);
      expect(withMissing[i].rank).to.equal(pure[i].rank);
      expect(withMissing[i].zones).to.equal(pure[i].zones);
    }
    // The two missing entries draw each other; equal on (score, zones) by
    // construction they are TIED under D3-B and share a competition rank.
    expect(withMissing[6].scoreHalf).to.equal(7);
    expect(withMissing[7].scoreHalf).to.equal(7);
    expect(withMissing[6].rank).to.equal(7);
    expect(withMissing[7].rank).to.equal(7);
  });
  it('rejects gapped seat indices', () => {
    expect(() => scoreWithMissing([{ index: 1, battles: null }])).to.throw('without gaps');
  });
});

/**
 * The seat `buildSealedPool`'s untouched field ranks first, and therefore the
 * seat whose battle set the collusion fixture below duplicates.
 *
 * Read off the fixture rather than guessed, and asserted by the collusion
 * test itself (the committed paid set must be exactly the two colluders), so
 * a change to the fixture's allocations fails loudly here instead of quietly
 * hollowing out the escrow assertions — which is precisely what audit G-14
 * found had already happened.
 */
const WINNING_SEAT = 47;

describe('detection wired into the crank (R11, roadmap 4.3)', () => {
  it('two colluding wallets are flagged before payment and their shares escrow', async function () {
    this.timeout(30000);
    const t = await buildSealedPool({});
    const { detectPool } = require('../../detection/src');
    const deps = {
      chain: t.chain,
      custody: t.custody,
      ciphertexts: t.store,
      publisher: t.publisher,
      detect: async (_poolId: bigint, entries: unknown[]) => {
        const report = detectPool(
          '1',
          (entries as Array<Record<string, unknown>>)
            .filter((e) => e.battles !== null)
            .map((e) => ({
              player: e.player,
              index: e.index,
              battles: e.battles,
              timingsMs: e.timingsMs ?? [],
              deviceHash: e.deviceHash ?? '',
              scoreHalf: e.scoreHalf,
            })),
          { fullEscrowTier: false }
        );
        return report.hardBlocks;
      },
    };
    // Make two seats colluders in the STORE before cranking: identical
    // battle sets and one shared device hash. The pool key comes back from
    // custody (the chain is already Sealed, so the export policy passes).
    //
    // WHICH SEATS, AND WHY IT MATTERS (audit 2026-09-11, G-14). This used to
    // put seat 0's battle set on seats 0 and 1. With this fixture's field
    // the committed paid set is seat 47, so neither colluder was ever in it,
    // and the escrow half of this test — the half that checks a flagged
    // winner's share is held rather than paid — sat inside an unguarded `if`
    // and asserted nothing on every run it had ever made.
    //
    // The colluders are now the WINNING seat and one other, sharing the
    // winning set. Two identical entries draw with each other and score
    // alike against the whole field, so they tie for first and BOTH land in
    // the committed payout list — which is the only arrangement in which the
    // escrow path is reached at all. The assertion below is unconditional
    // and checks that the paid set really does contain them, so this can
    // never silently go hollow again.
    const COLLUDERS = [0, WINNING_SEAT];
    const { seal, encodePayload, publicKeyOf } = require('../../sealing/src');
    const { createHash } = require('crypto');
    const s = (x: string) => new Uint8Array(createHash('sha256').update(x).digest());
    const secret = await t.custody.exportSecret(1n);
    const poolPk = publicKeyOf(secret);
    for (const seat of COLLUDERS) {
      const payload = {
        battles: t.battles[WINNING_SEAT], // the winning set on both — an exact duplicate
        salt: s(`salt:${seat}`),
        timingsMs: [1000, 2000, 3000, 4000, 5000, 6000, 7000],
        deviceHash: s('shared-device'),
      };
      await t.store.put(1n, t.players[seat], seal(encodePayload(payload), poolPk));
      // The on-chain battles_hash must match the duplicate content.
      const { battlesHash } = require('../../scoring/src');
      const entries = t.chain.entries.get('1')!;
      entries[seat].battlesHash = Buffer.from(battlesHash(payload.battles, payload.salt)).toString('hex');
    }

    const outcome = await crankPool(deps, 1n);
    expect(outcome.finalState).to.equal('Paid');
    expect(outcome.stepsTaken.filter((x) => x === 'flag_entry').length).to.equal(
      COLLUDERS.length
    );

    // A flagged seat in the committed paid set has its share ESCROWED, not
    // paid. Unconditional (G-14): the paid set must contain the colluders,
    // and each of them must be held.
    const pool = await t.chain.getPool(1n);
    const committedSeats = pool.payouts.map((x) => x.entryIndex).sort((a, b) => a - b);
    expect(
      committedSeats,
      'the colluders must BE the paid set, or this test checks nothing about escrow'
    ).to.deep.equal([...COLLUDERS].sort((a, b) => a - b));
    for (const seat of COLLUDERS) {
      const player = t.players[seat];
      expect(
        (t.chain.escrowed.get(player) ?? 0n) > 0n,
        `seat ${seat} is flagged and in the paid set: its share must be held`
      ).to.equal(true);
      expect(t.chain.paid.get(player) ?? 0n, `seat ${seat} must not be paid`).to.equal(0n);
    }
    // Nothing reached any wallet at all: both committed seats are held.
    expect([...t.chain.paid.values()].filter((v) => v > 0n)).to.deep.equal([]);
    // Total conservation: paid + escrowed == the whole pot.
    const pot = potForTier(0);
    let total = 0n;
    for (const v of t.chain.paid.values()) total += v;
    for (const v of t.chain.escrowed.values()) total += v;
    expect(total).to.equal(pot);
  });

  it('flags nobody when detection returns nothing — the production contract (G-13)', async function () {
    this.timeout(30000);
    // WHAT PRODUCTION ACTUALLY DOES (audit 2026-09-11, G-13). Every crank
    // detection test in this file injects a `detect` that returns
    // `report.hardBlocks`. `backend/reveal/src/main.ts` returns an EMPTY
    // list: under founder ruling D-E9 the report is computed and persisted
    // for the reviewer, and a flag is a reviewer's signed decision, never the
    // daemon's. So the behaviour the deployment has — signals run, nothing
    // is acted on — was asserted nowhere, and a regression that made the
    // daemon start auto-flagging would have passed every suite here.
    //
    // Same colluding field as the test above, so the signals genuinely fire;
    // only the hook's answer changes.
    const t = await buildSealedPool({});
    const { detectPool } = require('../../detection/src');
    const reports: Array<{ hardBlocks: string[]; reviewRecommended: string[] }> = [];
    const deps = {
      chain: t.chain,
      custody: t.custody,
      ciphertexts: t.store,
      publisher: t.publisher,
      detect: async (_poolId: bigint, entries: RevealedForDetection[]) => {
        reports.push(
          detectPool(
            '1',
            entries
              .filter((e) => e.battles !== null)
              .map((e) => ({
                player: e.player,
                index: e.index,
                battles: e.battles,
                timingsMs: e.timingsMs ?? [],
                deviceHash: e.deviceHash ?? '',
                scoreHalf: e.scoreHalf,
              })),
            { fullEscrowTier: false }
          )
        );
        return [];
      },
    };
    const { seal, encodePayload, publicKeyOf } = require('../../sealing/src');
    const { createHash } = require('crypto');
    const s = (x: string) => new Uint8Array(createHash('sha256').update(x).digest());
    const secret = await t.custody.exportSecret(1n);
    const poolPk = publicKeyOf(secret);
    for (const seat of [0, WINNING_SEAT]) {
      const payload = {
        battles: t.battles[WINNING_SEAT],
        salt: s(`salt:${seat}`),
        timingsMs: [1000, 2000, 3000, 4000, 5000, 6000, 7000],
        deviceHash: s('shared-device'),
      };
      await t.store.put(1n, t.players[seat], seal(encodePayload(payload), poolPk));
      const { battlesHash } = require('../../scoring/src');
      const entries = t.chain.entries.get('1')!;
      entries[seat].battlesHash = Buffer.from(
        battlesHash(payload.battles, payload.salt)
      ).toString('hex');
    }

    const outcome = await crankPool(deps, 1n);
    expect(outcome.finalState).to.equal('Paid');

    // The signals fired — this is not a pool detection found nothing in.
    expect(reports.length).to.equal(1);
    expect(reports[0].hardBlocks.length, 'an exact duplicate IS a hard block').to.be.greaterThan(0);

    // And the crank acted on none of it.
    expect(
      outcome.stepsTaken.filter((x) => x === 'flag_entry'),
      'the daemon must never flag on its own'
    ).to.deep.equal([]);
    const chainEntries = await t.chain.getEntries(1n);
    expect(chainEntries.filter((e) => e.flagged).map((e) => e.index)).to.deep.equal([]);
    expect([...t.chain.escrowed.values()].filter((v) => v > 0n)).to.deep.equal([]);
    let paid = 0n;
    for (const v of t.chain.paid.values()) paid += v;
    expect(paid, 'the whole pot reached wallets').to.equal(potForTier(0));
  });

  it('publishes neither the device hash nor the timings, and still hands both to detection (B-31)', async function () {
    this.timeout(30000);
    // One unreadable seat, so the channel's null case is exercised too.
    const t = await buildSealedPool({ missing: 3 });
    const seen: RevealedForDetection[][] = [];
    const deps = {
      chain: t.chain,
      custody: t.custody,
      ciphertexts: t.store,
      publisher: t.publisher,
      detect: async (_poolId: bigint, entries: RevealedForDetection[]) => {
        seen.push(entries);
        return [];
      },
    };
    const outcome = await crankPool(deps, 1n);
    expect(outcome.finalState).to.equal('Paid');

    // The published object — after the JSON round trip MemoryPublisher
    // performs — is version 2 and carries neither key on any entry. The
    // bundle is permanent public storage; these two fields identify a
    // browser across pools and time a player's screens, and no verification
    // step reads either.
    const bundle = t.publisher.published.get(outcome.bundleUri!)!;
    expect(bundle.version).to.equal(2);
    expect(bundle.entries.length).to.equal(64);
    for (const e of bundle.entries) {
      expect(e).to.not.have.property('device_hash');
      expect(e).to.not.have.property('timings_ms');
    }
    expect(JSON.stringify(bundle)).to.not.match(/device_hash|timings_ms/);

    // Detection received the sealed timings and device hash for every
    // readable seat, the battles decoded, and null for the unreadable one.
    expect(seen.length, 'the detection hook must have run exactly once').to.equal(1);
    const byIndex = new Map(seen[0].map((d) => [d.index, d]));
    expect(byIndex.size).to.equal(64);
    for (let i = 0; i < 64; i++) {
      const d = byIndex.get(i)!;
      expect(d.player).to.equal(t.players[i]);
      if (i === 3) {
        expect(d.battles).to.equal(null);
        expect(d.timingsMs).to.equal(null);
        expect(d.deviceHash).to.equal(null);
        continue;
      }
      expect(d.deviceHash).to.equal(hex(sha(`device:${i}`)));
      expect(d.timingsMs).to.deep.equal([1000, 2000, 3000, 4000, 5000, 6000, 7000]);
      expect(d.battles).to.deep.equal(t.battles[i].map((b) => [...b]));
      expect(d.scoreHalf).to.be.a('number');
    }
  });
});

/*
 * The publish record (2026-09-12, audit 2026-09-11: C-09 / B-32 / D-27) and
 * the entry-refund alert (C-12).
 */
class CountingPublisher {
  calls = 0;
  readonly failFirst: number;
  constructor(failFirst = 0) {
    this.failFirst = failFirst;
  }
  async publish(bundle: { pool_id: string }): Promise<string> {
    this.calls++;
    if (this.calls <= this.failFirst) throw new Error('irys down');
    return `counting://${bundle.pool_id}/${this.calls}`;
  }
}

describe('the settlement crank: the publish record (2026-09-12)', () => {
  it('records the upload, and a resumed crank never uploads a bundle already on record', async function () {
    this.timeout(30000);
    const t = await buildSealedPool({});
    const publisher = new CountingPublisher();
    const published = new MemoryPublishedBundleStore();
    const deps = { chain: t.chain, custody: t.custody, ciphertexts: t.store, publisher, published };
    const first = await crankPool(deps, 1n);
    expect(first.finalState).to.equal('Paid');
    expect(first.bundleUri).to.equal('counting://1/1');
    expect(await published.find(1n)).to.equal('counting://1/1');
    // Resume: the pool is Paid, the record says published — no second object.
    const again = await crankPool(deps, 1n);
    expect(again.bundleUri).to.equal('counting://1/1');
    expect(again.stepsTaken).to.include('publish:already');
    expect(publisher.calls).to.equal(1, 'the permanent record is written once');
  });

  it('publishBundle publishes a Paid pool whose upload failed at settlement, records it, and refuses to do it twice', async function () {
    this.timeout(30000);
    const t = await buildSealedPool({});
    const published = new MemoryPublishedBundleStore();
    const publisher = new CountingPublisher(1); // the settlement's upload fails
    const deps = { chain: t.chain, custody: t.custody, ciphertexts: t.store, publisher, published };
    const settled = await crankPool(deps, 1n);
    expect(settled.finalState).to.equal('Paid');
    expect(settled.stepsTaken).to.include('publish-failed');
    expect(await published.find(1n)).to.equal(null, 'nothing on record after a failed upload');

    const uri = await publishBundle(deps, 1n);
    expect(uri).to.equal('counting://1/2');
    expect(await published.find(1n)).to.equal('counting://1/2');
    const same = await publishBundle(deps, 1n);
    expect(same).to.equal('counting://1/2');
    expect(publisher.calls).to.equal(2, 'the owed bundle is uploaded exactly once');
  });

  it('publishBundle refuses a pool that is not Paid', async function () {
    this.timeout(30000);
    const t = await buildSealedPool({});
    const deps = { chain: t.chain, custody: t.custody, ciphertexts: t.store, publisher: t.publisher };
    let refused = '';
    try {
      await publishBundle(deps, 1n);
    } catch (e) {
      refused = String(e);
    }
    expect(refused).to.include('not Paid');
  });

  it('raises the entry-refund alert naming every all-losses player (C-12)', async function () {
    this.timeout(30000);
    const t = await buildSealedPool({ missing: 3, garbage: 7 });
    const alerts: { reason: string; detail: Record<string, unknown> }[] = [];
    const monitor = {
      recordEvent: () => {},
      reportGauge: () => {},
      alert: (reason: string, detail: Record<string, unknown>) => {
        alerts.push({ reason, detail });
      },
    };
    const deps = { chain: t.chain, custody: t.custody, ciphertexts: t.store, publisher: t.publisher, monitor };
    await crankPool(deps, 1n);
    expect(alerts.map((a) => a.reason)).to.deep.equal([ALERT.reveal.entryRefundOwed]);
    expect(alerts[0].detail.poolId).to.equal('1');
    // Rewritten in place on 2026-09-16 (the founder's data-minimisation ruling
    // of 2026-09-15): the alert names HOW MANY and the TRUNCATED wallets,
    // never a whole address — an alert can be forwarded off-box. The bundle's
    // `scored_as_all_losses` remains the full list the manual pays from.
    expect(alerts[0].detail.count).to.equal(2);
    expect((alerts[0].detail.players as string[]).sort()).to.deep.equal(
      [short(t.players[3]), short(t.players[7])].sort()
    );
    for (const named of alerts[0].detail.players as string[]) {
      expect(named).to.not.equal(t.players[3]);
      expect(named).to.not.equal(t.players[7]);
    }
    expect(alerts[0].detail.entryLamports).to.equal('100000000');
  });
});
