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

/** Enter `n` players into an Open pool with real sealed ciphertexts, then
 * apply the program's post-entry transitions (the go-timer at 52, the seal
 * at 64) exactly as `register` would. */
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
    w.chain.applyEntryTransitions(poolId);
  }
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

  it('nothing happens AT the deadline — both instructions compare strictly', async () => {
    const w = await makeWorld();
    await w.daemon.tick();
    await enterPlayers(w, 1n, 3);
    w.clock.t = (await w.chain.getPool(1n)).fillDeadline; // equal, not past
    const r = await w.daemon.tick();
    expect(r.errors).to.deep.equal([]);
    expect(r.refundsTriggered).to.deep.equal([]);
    expect(r.sealedAtDeadline).to.deep.equal([]);
    expect((await w.chain.getPool(1n)).state).to.equal('Open');
  });
});

describe('the daemon (C8): the minimum field (D-E4)', () => {
  it('the 52nd seat starts the go-timer: the deadline shortens to now + 6h, once', async () => {
    const w = await makeWorld();
    await w.daemon.tick(); // opens pool 1 at t = 1_000
    const opened = (await w.chain.getPool(1n)).fillDeadline;
    expect(opened).to.equal(1_000n + 72n * 3600n);

    await enterPlayers(w, 1n, 51);
    expect((await w.chain.getPool(1n)).fillDeadline).to.equal(opened, '51 seats: untouched');

    w.clock.t = 5_000n;
    await enterPlayers(w, 1n, 1); // the 52nd
    const go = (await w.chain.getPool(1n)).fillDeadline;
    expect(go).to.equal(5_000n + w.chain.goTimerSecs);

    w.clock.t = 9_000n;
    await enterPlayers(w, 1n, 5); // 57 seats — later entries never extend it
    expect((await w.chain.getPool(1n)).fillDeadline).to.equal(go);
  });

  it('a 52-seat pool past its go-deadline seals, cranks to Paid and the tier reopens', async function () {
    this.timeout(30000);
    const w = await makeWorld();
    await w.daemon.tick(); // opens pool 1
    await enterPlayers(w, 1n, 52);

    // Before the go-deadline: Open, nothing to do.
    const idle = await w.daemon.tick();
    expect(idle.sealedAtDeadline).to.deep.equal([]);
    expect(idle.cranked).to.deep.equal([]);
    expect((await w.chain.getPool(1n)).state).to.equal('Open');

    w.clock.t = (await w.chain.getPool(1n)).fillDeadline + 1n;
    const r = await w.daemon.tick();
    expect(r.errors).to.deep.equal([]);
    expect(r.sealedAtDeadline).to.deep.equal([1n]);
    expect(r.refundsTriggered).to.deep.equal([]);
    expect(r.cranked).to.deep.equal([{ poolId: 1n, finalState: 'Paid' }]);
    expect(r.opened).to.deep.equal([{ poolId: 2n, tier: 0 }]);

    // Conservation over the real 52-seat field: the paid set carries
    // exactly the pot, and nobody outside rank 1 is in it (D-E2).
    const pool = await w.chain.getPool(1n);
    expect(pool.entrants).to.equal(52);
    let total = 0n;
    for (const c of pool.payouts) total += c.amountLamports;
    expect(total).to.equal(potForTier(0));
    let paid = 0n;
    for (const v of w.chain.paid.values()) paid += v;
    expect(paid).to.equal(potForTier(0));
    // The seal turned the entries into revenue: nothing refundable remains
    // and the treasury holds the 52 entries less the pot it funded.
    expect((await w.chain.getConfig()).platformRefundable).to.equal(0n);
  });

  it('a 63-seat pool seals the same way; a 51-seat pool refunds instead', async function () {
    this.timeout(30000);
    const w = await makeWorld();
    await w.daemon.tick(); // pool 1
    await enterPlayers(w, 1n, 63);
    w.clock.t = (await w.chain.getPool(1n)).fillDeadline + 1n;
    const r1 = await w.daemon.tick();
    expect(r1.errors).to.deep.equal([]);
    expect(r1.sealedAtDeadline).to.deep.equal([1n]);
    expect(r1.cranked).to.deep.equal([{ poolId: 1n, finalState: 'Paid' }]);
    expect(r1.opened).to.deep.equal([{ poolId: 2n, tier: 0 }]);

    const players = await enterPlayers(w, 2n, 51);
    w.clock.t = (await w.chain.getPool(2n)).fillDeadline + 1n;
    const r2 = await w.daemon.tick();
    expect(r2.errors).to.deep.equal([]);
    expect(r2.sealedAtDeadline).to.deep.equal([]);
    expect(r2.refundsTriggered).to.deep.equal([2n]);
    expect(r2.cranked).to.deep.equal([{ poolId: 2n, finalState: 'Closed' }]);
    for (const p of players) {
      expect(w.chain.paid.get(p)).to.equal(TIER_ENTRY_LAMPORTS[0]); // 100% back (R7)
    }
  });

  it('the seal is refused below 52 and the refund is refused at 52 (the guards mirror the program)', async () => {
    const w = await makeWorld();
    await w.daemon.tick();
    await enterPlayers(w, 1n, 51);
    w.clock.t = (await w.chain.getPool(1n)).fillDeadline + 1n;
    await expectRejects(() => w.chain.sealAtDeadline(1n), 'FieldBelowMinimum');
    await enterPlayers(w, 1n, 1); // 52 — the go-timer cannot extend a past deadline
    await expectRejects(() => w.chain.triggerRefund(1n), 'FieldReached');
    await w.chain.sealAtDeadline(1n);
    expect((await w.chain.getPool(1n)).state).to.equal('Sealed');
  });
});

async function expectRejects(fn: () => Promise<unknown>, message: string): Promise<void> {
  let caught = '';
  try {
    await fn();
  } catch (e) {
    caught = String(e);
  }
  expect(caught, `expected ${message}`).to.include(message);
}

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

describe('the daemon (proposal E1 §5.3): the keeper-cost seam', () => {
  // The platform PDA cannot sign, so every fee and rent comes from the
  // keeper's own signer wallet — the one main.ts floor-checks at startup
  // (SETTLEMENT_FLOOR_LAMPORTS) and re-reads once per tick into /health.
  // The cost instrumentation will measure per-cycle deltas at exactly
  // this seam: read balance, run the tick, read again, attribute the
  // delta to the tick's outcomes. This test pins that measurement SHAPE
  // against the daemon as it exists — spec-local metering only, no
  // production change — so the instrumentation lands on a proven pattern.
  class MeteredChain extends FakeChain {
    /** The keeper's hot-wallet balance, spec-local (1 SOL). */
    keeperLamports = 1_000_000_000n;
    private meter(): void {
      this.keeperLamports -= 5_000n; // one base fee per sent transaction
    }
    override async openPool(
      poolId: bigint,
      tier: number,
      sealingPubkey: Uint8Array,
      sealingSecretHash: Uint8Array
    ): Promise<void> {
      this.meter();
      return super.openPool(poolId, tier, sealingPubkey, sealingSecretHash);
    }
    override async commitVrfSeed(poolId: bigint, randomnessAccount: string): Promise<void> {
      this.meter();
      return super.commitVrfSeed(poolId, randomnessAccount);
    }
    override async createPassCollection(poolId: bigint): Promise<void> {
      this.meter();
      return super.createPassCollection(poolId);
    }
  }

  it('a tick is measurable: balance before, after, delta keyed by the tick report', async () => {
    const clock = { t: 1_000n };
    const chain = new MeteredChain(() => clock.t);
    await chain.initConfig({
      entrySigner: 'entry',
      settlementSigner: 'settle',
      vaultCeilingLamports: TIER_ENTRY_LAMPORTS.map((e) => e * 64n),
      treasuryMinPlatformLamports: 0n,
    });
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
      crank: (poolId) => crankPool({ chain, custody, ciphertexts: store, publisher }, poolId),
      now: () => clock.t,
    });

    const before = chain.keeperLamports;
    const report = await daemon.tick();
    const after = chain.keeperLamports;
    const spent = before - after;

    // The first tick opens tier 0 and completes its launch: open_pool,
    // commit_vrf_seed, create_pass_collection — three sends.
    expect(report.opened).to.deep.equal([{ poolId: 1n, tier: 0 }]);
    expect(spent).to.equal(3n * 5_000n);

    // The ops_costs row shape (§5.3): the delta keys by pool and outcome,
    // and stays bigint end to end — a lamport value never touches a float.
    const row = {
      pool: report.opened[0].poolId,
      outcome: 'opened' as const,
      lamports_spent: spent,
    };
    expect(row.lamports_spent > 0n).to.equal(true);

    // A quiet second tick spends nothing — the meter reads zero, so the
    // instrumentation can skip writing a row rather than logging noise.
    const idleBefore = chain.keeperLamports;
    await daemon.tick();
    expect(chain.keeperLamports).to.equal(idleBefore);
  });
});

describe('the daemon (E3 §4.4): the bundle-announce seam', () => {
  it('announces each published bundle URI once; refunds announce nothing', async () => {
    const w = await makeWorld();
    const announced: Array<{ poolId: bigint; uri: string }> = [];
    // Same world, second daemon with the seam wired — the deps contract
    // makes announce additive, so nothing else changes.
    const daemon = makeDaemon({
      chain: w.chain,
      custody: w.custody,
      vrf: new StubVrfCoordinator(w.chain, base58Encode(sha('randomness'))),
      crank: (poolId) =>
        crankPool({ chain: w.chain, custody: w.custody, ciphertexts: w.store, publisher: w.publisher }, poolId),
      now: () => w.clock.t,
      announceBundle: async (poolId, uri) => {
        announced.push({ poolId, uri });
      },
    });

    await daemon.tick(); // opens pool 1
    await enterPlayers(w, 1n, 64);
    const r = await daemon.tick(); // cranks to Paid, publishes, announces
    expect(r.errors).to.deep.equal([]);
    expect(announced).to.have.length(1);
    expect(announced[0].poolId).to.equal(1n);
    expect(w.publisher.published.has(announced[0].uri)).to.equal(
      true,
      'the announced URI is exactly the published one'
    );

    // The refund fork publishes no bundle, so it announces nothing.
    await enterPlayers(w, 2n, 3);
    w.clock.t = (await w.chain.getPool(2n)).fillDeadline + 1n;
    const r2 = await daemon.tick();
    expect(r2.cranked).to.deep.equal([{ poolId: 2n, finalState: 'Closed' }]);
    expect(announced).to.have.length(1);
  });

  it('a failing announce is a tick error, never a blocked settlement (fire-safe)', async () => {
    const w = await makeWorld();
    const daemon = makeDaemon({
      chain: w.chain,
      custody: w.custody,
      vrf: new StubVrfCoordinator(w.chain, base58Encode(sha('randomness'))),
      crank: (poolId) =>
        crankPool({ chain: w.chain, custody: w.custody, ciphertexts: w.store, publisher: w.publisher }, poolId),
      now: () => w.clock.t,
      announceBundle: async () => {
        throw new Error('indexer unreachable');
      },
    });

    await daemon.tick();
    await enterPlayers(w, 1n, 64);
    const r = await daemon.tick();

    // Settlement finished and the tier reopened despite the announce failure.
    expect(r.cranked).to.deep.equal([{ poolId: 1n, finalState: 'Paid' }]);
    expect(r.opened).to.deep.equal([{ poolId: 2n, tier: 0 }]);
    expect(r.errors).to.have.length(1);
    expect(r.errors[0].action).to.equal('announce_bundle');
    expect(r.errors[0].poolId).to.equal('1');
  });
});
