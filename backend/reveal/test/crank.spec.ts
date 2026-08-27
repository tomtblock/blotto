/**
 * Crank specs (roadmap 2.4), offline: FakeChain mirrors the program's state
 * machine, LocalCustody enforces the export policy, MemoryPublisher captures
 * the bundle. The devnet run of the same crank is the Phase 5 rehearsal.
 */
import { expect } from 'chai';
import { createHash } from 'crypto';
import {
  crankPool,
  FakeChain,
  MemoryPublisher,
  scoreWithMissing,
  type ChainEntryView,
} from '../src';
import {
  LocalCustody,
  MemoryCiphertextStore,
  encodePayload,
  seal,
  type SealedPayload,
} from '../../sealing/src';
import {
  amountForRank,
  battlesHash,
  potLamports,
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
  const chain = new FakeChain((entry, rank) => amountForRank(potLamports(entry), rank));
  const custody = new LocalCustody(async (id) => {
    const p = await chain.getPool(id);
    return p.state !== 'Open';
  });
  const store = new MemoryCiphertextStore();
  const publisher = new MemoryPublisher();

  const { publicKey } = await custody.createPoolKey(1n);
  const players: string[] = [];
  const battles: BattleSet[] = [];
  const entries: ChainEntryView[] = [];

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
    entries.push({ player, index: i, battlesHash: onChainHash, flagged: false, refunded: false });
    if (sabotage.missing === i) continue; // never stored
    if (sabotage.garbage === i) {
      await store.put(1n, player, sha(`garbage:${i}`)); // not a sealed box
    } else {
      await store.put(1n, player, seal(encodePayload(payload), publicKey));
    }
  }

  chain.pools.set('1', {
    poolId: 1n,
    state: 'Sealed',
    entryLamports: 100_000_000n,
    fillDeadline: 0n,
    secretRevealed: false,
    resultsCommitted: false,
    paidMask: 0,
    winners: [],
    entrants: 64,
  });
  chain.entries.set('1', entries);
  return { chain, custody, store, publisher, players, battles };
}

describe('the settlement crank', () => {
  it('drives a sealed pool to Paid with every band exact', async function () {
    this.timeout(30000);
    const t = await buildSealedPool({});
    const outcome = await crankPool(
      { chain: t.chain, custody: t.custody, ciphertexts: t.store, publisher: t.publisher },
      1n
    );
    expect(outcome.finalState).to.equal('Paid');
    expect(outcome.bundleUri).to.be.a('string');

    // The bundle's ranking equals the pure engine's over the same battles.
    const bundle = t.publisher.published.get(outcome.bundleUri!)!;
    const engine = scorePool(t.battles);
    for (const r of bundle.results) {
      const e = engine[r.index];
      expect(r.score_half).to.equal(e.scoreHalf);
      expect(r.rank).to.equal(e.rank);
    }
    expect(bundle.scored_as_all_losses).to.deep.equal([]);
    expect(bundle.results_root).to.equal(hex(t.chain.committedRoots.get('1')!));

    // Every winner got exactly the band amount; total = the whole pot.
    const pot = potLamports(100_000_000n);
    let total = 0n;
    for (let rank = 1; rank <= 16; rank++) {
      const player = (await t.chain.getPool(1n)).winners[rank - 1];
      expect(t.chain.paid.get(player)).to.equal(amountForRank(pot, rank));
      total += amountForRank(pot, rank);
    }
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

    // First run, but the chain dies after the first pay batch.
    const original = t.chain.payPrizes.bind(t.chain);
    let batches = 0;
    t.chain.payPrizes = async (poolId, ranks) => {
      if (batches++ === 1) throw new Error('rpc died');
      return original(poolId, ranks);
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
    const pot = potLamports(100_000_000n);
    let total = 0n;
    for (const v of t.chain.paid.values()) total += v;
    expect(total).to.equal(pot, 'no rank paid twice, none skipped');
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
    const chain = new FakeChain(() => 0n);
    chain.pools.set('9', {
      poolId: 9n,
      state: 'Refunding',
      entryLamports: 100_000_000n,
      fillDeadline: 0n,
      secretRevealed: false,
      resultsCommitted: false,
      paidMask: 0,
      winners: [],
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
    // The two missing entries draw each other and rank by index at the bottom.
    expect(withMissing[6].scoreHalf).to.equal(7);
    expect(withMissing[7].scoreHalf).to.equal(7);
    expect(withMissing[6].rank).to.equal(7);
    expect(withMissing[7].rank).to.equal(8);
  });
  it('rejects gapped seat indices', () => {
    expect(() => scoreWithMissing([{ index: 1, battles: null }])).to.throw('without gaps');
  });
});
