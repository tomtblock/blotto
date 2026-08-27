/**
 * Daemon specs (C8): the keeper + settlement loop over FakeChain, which
 * mirrors the program's guards (gapless ids, one Open pool per tier,
 * write-once VRF/collection, the paid-mask). The two named master-prompt
 * cases — resume-after-crash and double-run — are here, alongside the
 * product loop itself: seal → crank to Paid → the tier reopens.
 */
import { expect } from 'chai';
import { createHash } from 'crypto';
import {
  FakeChain,
  MemoryPublisher,
  StubVrfCoordinator,
  crankPool,
  makeDaemon,
  type Daemon,
  type KeeperChain,
} from '../src';
import {
  LocalCustody,
  MemoryCiphertextStore,
  encodePayload,
  seal,
  type SealedPayload,
} from '../../sealing/src';
import { battlesHash, potForTier, TIER_ENTRY_LAMPORTS, type BattleSet } from '../../scoring/src';
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

interface World {
  chain: FakeChain;
  custody: LocalCustody;
  store: MemoryCiphertextStore;
  publisher: MemoryPublisher;
  daemon: Daemon;
  clock: { t: bigint };
}

async function makeWorld(): Promise<World> {
  const clock = { t: 1_000n };
  const chain = new FakeChain(() => clock.t);
  await chain.initConfig({
    entrySigner: 'entry',
    settlementSigner: 'settle',
    vaultCeilingLamports: TIER_ENTRY_LAMPORTS.map((e) => e * 64n),
    treasuryMinPlatformLamports: 0n,
  });
  // Bootstrap the prize treasury far past every test's policy floor (the
  // treasury-policy specs fund their own exact amounts).
  chain.fundPlatform(1_800_000_000_000n);
  const custody = new LocalCustody(async (id) => {
    const p = await chain.getPool(id);
    return p.state !== 'Open';
  });
  const store = new MemoryCiphertextStore();
  const publisher = new MemoryPublisher();
  const daemon = makeDaemon({
    chain,
    custody,
    vrf: new StubVrfCoordinator(chain, base58Encode(sha('randomness'))),
    crank: (poolId) =>
      crankPool({ chain, custody, ciphertexts: store, publisher }, poolId),
    now: () => clock.t,
  });
  return { chain, custody, store, publisher, daemon, clock };
}

/** Enter `n` players into an Open pool with real sealed ciphertexts; seal
 * the pool (the 64th register's effect) when it fills. */
async function enterPlayers(w: World, poolId: bigint, n: number): Promise<string[]> {
  const key = w.chain.openedWith.get(poolId.toString());
  if (!key) throw new Error(`pool ${poolId} was never opened`);
  const entries = w.chain.entries.get(poolId.toString())!;
  const pool = w.chain.pools.get(poolId.toString())!;
  const players: string[] = [];
  for (let i = 0; i < n; i++) {
    const player = base58Encode(sha(`p:${poolId}:${i}`));
    players.push(player);
    const payload: SealedPayload = {
      battles: battlesFor(i * 100),
      salt: sha(`salt:${poolId}:${i}`),
      timingsMs: [1000, 2000, 3000, 4000, 5000, 6000, 7000],
      deviceHash: sha(`device:${poolId}:${i}`),
    };
    entries.push({
      player,
      index: entries.length,
      battlesHash: hex(battlesHash(payload.battles, payload.salt)),
      flagged: false,
      refunded: false,
    });
    pool.entrants = entries.length;
    await w.store.put(poolId, player, seal(encodePayload(payload), key.publicKey));
  }
  if (pool.entrants === 64) w.chain.sealPool(poolId);
  return players;
}

describe('the daemon (C8): keeper', () => {
  it('first tick opens one launch-complete pool for the open tier; second tick is a no-op', async () => {
    const w = await makeWorld();
    const r1 = await w.daemon.tick();
    expect(r1.errors).to.deep.equal([]);
    expect(r1.opened).to.deep.equal([{ poolId: 1n, tier: 0 }]);
    expect(r1.completed).to.deep.equal([
      { poolId: 1n, step: 'vrf' },
      { poolId: 1n, step: 'pass_collection' },
    ]);
    const pool = await w.chain.getPool(1n);
    expect(pool.state).to.equal('Open');
    expect(pool.vrfCommitted).to.equal(true);
    expect(await w.chain.hasPassCollection(1n)).to.equal(true);
    expect((await w.chain.getConfig()).activePoolByTier[0]).to.equal(1n);

    const r2 = await w.daemon.tick();
    expect(r2.errors).to.deep.equal([]);
    expect(r2.opened).to.deep.equal([]);
    expect(r2.completed).to.deep.equal([]);
    expect((await w.chain.getConfig()).nextPoolId).to.equal(2n);
  });

  it('every open tier gets its own pool, ids gapless in tier order', async () => {
    const w = await makeWorld();
    w.chain.config!.openTiers = [true, true, true, false, false, false, false];
    const r = await w.daemon.tick();
    expect(r.errors).to.deep.equal([]);
    expect(r.opened).to.deep.equal([
      { poolId: 1n, tier: 0 },
      { poolId: 2n, tier: 1 },
      { poolId: 3n, tier: 2 },
    ]);
    // D1: each pool carries its own tier's entry price.
    expect((await w.chain.getPool(2n)).entryLamports).to.equal(TIER_ENTRY_LAMPORTS[1]);
  });

  it('a paused config holds the keeper (settlement is separate)', async () => {
    const w = await makeWorld();
    w.chain.config!.paused = true;
    const r = await w.daemon.tick();
    expect(r.opened).to.deep.equal([]);
    expect(r.errors).to.deep.equal([]);
    w.chain.config!.paused = false;
    expect((await w.daemon.tick()).opened).to.deep.equal([{ poolId: 1n, tier: 0 }]);
  });
});

describe('the daemon (C8): the product loop', () => {
  it('seal -> crank to Paid -> the tier reopens, all in one tick', async function () {
    this.timeout(30000);
    const w = await makeWorld();
    await w.daemon.tick(); // opens pool 1
    await enterPlayers(w, 1n, 64); // fills and seals it (slot frees)

    const r = await w.daemon.tick();
    expect(r.errors).to.deep.equal([]);
    expect(r.cranked).to.deep.equal([{ poolId: 1n, finalState: 'Paid' }]);
    expect(r.opened).to.deep.equal([{ poolId: 2n, tier: 0 }]);

    // Conservation: the paid set carries exactly the pot.
    const pot = potForTier(0);
    let paid = 0n;
    for (const v of w.chain.paid.values()) paid += v;
    expect(paid).to.equal(pot);

    // The successor is launch-complete and enterable state-wise.
    const p2 = await w.chain.getPool(2n);
    expect(p2.state).to.equal('Open');
    expect(p2.vrfCommitted).to.equal(true);
    expect(await w.chain.hasPassCollection(2n)).to.equal(true);
  });

  it('an Open pool past its deadline is refund-triggered, drained, and replaced', async () => {
    const w = await makeWorld();
    await w.daemon.tick(); // opens pool 1
    const players = await enterPlayers(w, 1n, 3); // under-filled
    w.clock.t = (await w.chain.getPool(1n)).fillDeadline + 1n;

    const r = await w.daemon.tick();
    expect(r.errors).to.deep.equal([]);
    expect(r.refundsTriggered).to.deep.equal([1n]);
    expect(r.cranked).to.deep.equal([{ poolId: 1n, finalState: 'Closed' }]);
    expect(r.opened).to.deep.equal([{ poolId: 2n, tier: 0 }]);
    for (const p of players) {
      expect(w.chain.paid.get(p)).to.equal(TIER_ENTRY_LAMPORTS[0]); // 100% back (R7)
    }
  });

  it('an empty pool past its deadline closes and is replaced', async () => {
    const w = await makeWorld();
    await w.daemon.tick();
    w.clock.t = (await w.chain.getPool(1n)).fillDeadline + 1n;
    const r = await w.daemon.tick();
    expect(r.errors).to.deep.equal([]);
    expect(r.refundsTriggered).to.deep.equal([1n]);
    expect((await w.chain.getPool(1n)).state).to.equal('Closed');
    expect(r.opened).to.deep.equal([{ poolId: 2n, tier: 0 }]);
  });
});

describe('the daemon (C8): resume after a crash', () => {
  it('a key created before the crash is republished, never regenerated', async () => {
    const w = await makeWorld();
    // The crash window: createPoolKey succeeded, open_pool never landed.
    const created = await w.custody.createPoolKey(1n);

    const r = await w.daemon.tick(); // a fresh daemon (no memory of the key)
    expect(r.errors).to.deep.equal([]);
    expect(r.opened).to.deep.equal([{ poolId: 1n, tier: 0 }]);
    // The pool was opened with EXACTLY the pre-crash key — the hash the
    // chain now carries commits to the secret custody actually holds.
    const published = w.chain.openedWith.get('1')!;
    expect(hex(published.publicKey)).to.equal(hex(created.publicKey));
    expect(hex(published.secretHash)).to.equal(hex(created.secretHash));
  });

  it('a pool opened before the crash is launch-completed, not duplicated', async () => {
    const w = await makeWorld();
    // The crash window: open_pool landed, VRF + collection never did.
    const key = await w.custody.createPoolKey(1n);
    await w.chain.openPool(1n, 0, key.publicKey, key.secretHash);

    const r = await w.daemon.tick();
    expect(r.errors).to.deep.equal([]);
    expect(r.opened).to.deep.equal([]); // no duplicate open
    expect(r.completed).to.deep.equal([
      { poolId: 1n, step: 'vrf' },
      { poolId: 1n, step: 'pass_collection' },
    ]);
    expect((await w.chain.getConfig()).nextPoolId).to.equal(2n);
  });

  it('a VRF failure is reported, the tick survives, the next tick completes', async () => {
    const w = await makeWorld();
    let failures = 1;
    const flaky = {
      commitSeed: async (poolId: bigint) => {
        if (failures > 0) {
          failures--;
          throw new Error('oracle unavailable');
        }
        await w.chain.commitVrfSeed(poolId, 'stub');
      },
    };
    const daemon = makeDaemon({
      chain: w.chain,
      custody: w.custody,
      vrf: flaky,
      crank: (id) =>
        crankPool(
          { chain: w.chain, custody: w.custody, ciphertexts: w.store, publisher: w.publisher },
          id
        ),
      now: () => w.clock.t,
    });

    const r1 = await daemon.tick();
    expect(r1.opened).to.deep.equal([{ poolId: 1n, tier: 0 }]);
    expect(r1.errors.length).to.equal(1);
    expect(r1.errors[0].action).to.equal('keeper');
    expect((await w.chain.getPool(1n)).vrfCommitted).to.equal(false);

    const r2 = await daemon.tick();
    expect(r2.errors).to.deep.equal([]);
    expect(r2.completed).to.deep.equal([
      { poolId: 1n, step: 'vrf' },
      { poolId: 1n, step: 'pass_collection' },
    ]);
  });
});

describe('the daemon (C8): double-run', () => {
  it('two daemons over one chain never double-open a tier', async () => {
    const w = await makeWorld();
    const second = makeDaemon({
      chain: w.chain,
      custody: w.custody,
      vrf: new StubVrfCoordinator(w.chain, 'stub'),
      crank: (id) =>
        crankPool(
          { chain: w.chain, custody: w.custody, ciphertexts: w.store, publisher: w.publisher },
          id
        ),
      now: () => w.clock.t,
    });

    // Concurrent ticks interleave at every await; the program-mirrored
    // guards decide the winner, the loser only records errors.
    await Promise.all([w.daemon.tick(), second.tick()]);

    const cfg = await w.chain.getConfig();
    expect(cfg.nextPoolId).to.equal(2n); // exactly ONE pool exists
    expect(cfg.activePoolByTier[0]).to.equal(1n);
    const pool = await w.chain.getPool(1n);
    expect(pool.state).to.equal('Open');
    expect(pool.vrfCommitted).to.equal(true);
    expect(await w.chain.hasPassCollection(1n)).to.equal(true);
  });

  it('two daemons settling one sealed pool never double-pay', async function () {
    this.timeout(30000);
    const w = await makeWorld();
    const second = makeDaemon({
      chain: w.chain,
      custody: w.custody,
      vrf: new StubVrfCoordinator(w.chain, 'stub'),
      crank: (id) =>
        crankPool(
          { chain: w.chain, custody: w.custody, ciphertexts: w.store, publisher: w.publisher },
          id
        ),
      now: () => w.clock.t,
    });
    await w.daemon.tick();
    await enterPlayers(w, 1n, 64);

    await Promise.all([w.daemon.tick(), second.tick()]);

    // Whatever the interleaving, the pool rests Paid and the money is
    // conserved exactly — the paid-mask (mirrored from the program) makes a
    // second settlement of any seat fail rather than pay twice.
    expect((await w.chain.getPool(1n)).state).to.equal('Paid');
    const pot = potForTier(0);
    let paid = 0n;
    for (const v of w.chain.paid.values()) paid += v;
    for (const v of w.chain.escrowed.values()) paid += v;
    expect(paid).to.equal(pot);
    // And the tier has exactly one successor.
    expect((await w.chain.getConfig()).nextPoolId).to.equal(3n);
    expect((await w.chain.getConfig()).activePoolByTier[0]).to.equal(2n);
  });
});

describe('the daemon (C8): run loop', () => {
  it('run() ticks until aborted and swallows tick failures', async () => {
    const w = await makeWorld();
    let ticks = 0;
    // Delegate everything to the real chain except getConfig, which counts
    // ticks and fails the first one.
    const chain = new Proxy(w.chain, {
      get(target, prop, receiver) {
        if (prop === 'getConfig') {
          return async () => {
            ticks++;
            if (ticks === 1) throw new Error('rpc down');
            return target.getConfig();
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    }) as KeeperChain;
    const daemon = makeDaemon({
      chain,
      custody: w.custody,
      vrf: new StubVrfCoordinator(w.chain, 'stub'),
      crank: async (id) => ({ poolId: id, finalState: 'Paid', stepsTaken: [] }),
      now: () => w.clock.t,
    });
    const ac = new AbortController();
    const done = daemon.run(5, ac.signal);
    await new Promise((r) => setTimeout(r, 40));
    ac.abort();
    await done;
    expect(ticks).to.be.greaterThan(2); // survived the first (failing) tick
  });
});
