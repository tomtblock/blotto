/**
 * Daemon specs (C8): the keeper + settlement loop over FakeChain, which
 * mirrors the program's guards (gapless ids, one Open pool per tier,
 * write-once VRF/collection, the paid-mask). The two named master-prompt
 * cases — resume-after-crash and double-run — are here, alongside the
 * product loop itself: seal → crank to Paid → the tier reopens.
 */
import { expect } from 'chai';
import { ALERT, METRIC } from '../../_shared/src/metrics';
import { createHash } from 'crypto';
import {
  FakeChain,
  MemoryPublisher,
  StubVrfCoordinator,
  crankPool,
  makeDaemon,
  type Daemon,
  type KeeperChain,
  type TickReport,
  MemoryPublishedBundleStore,
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
  boardModeOf,
  ladderTable,
  minFieldFor,
  prizePoolFor,
  REVIEW_WINDOW_SECS,
  scorePool,
  TIER_ENTRY_LAMPORTS,
  type BattleSet,
} from '../../scoring/src';
import { base58Encode } from '../../_shared/src/blotto-events';
import { LAUNCH_CAPACITIES, ladderChain, makePreLadder } from './ladder-fixtures';

/** The 64-player pool's prize pool at tier 0 (D-E19): its launch table at
 * the tier's price — what `open_pool` funds and the paid set must carry. */
const POT_64 = prizePoolFor(ladderTable(64), TIER_ENTRY_LAMPORTS[0]);

/** The launch posture (D-E19): both modes × the four sizes, at tier 0. */
const LAUNCH_TYPES: ReadonlyArray<readonly [number, number, number]> = [0, 1].flatMap((mode) =>
  LAUNCH_CAPACITIES.map((cap) => [mode, 0, cap] as const)
);

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

/**
 * A world with Config initialised and `types` enabled at the launch
 * economics. The default is ONE pool type — easy, tier 0, 64 players — so
 * the specs that are about settlement, the review clock or publication see
 * exactly one pool per tick, as they always have; the Ladder specs pass the
 * eight launch types.
 */
async function makeWorld(
  types: ReadonlyArray<readonly [number, number, number]> = [[0, 0, 64]]
): Promise<World> {
  const clock = { t: 1_000n };
  const chain = await ladderChain(() => clock.t, types);
  if (types.some(([mode]) => mode === 1)) {
    chain.setHardOpenTiers([true, false, false, false, false, false, false]);
  }
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
    ciphertexts: store,
    vrf: new StubVrfCoordinator(chain, base58Encode(sha('randomness'))),
    crank: (poolId) =>
      crankPool({ chain, custody, ciphertexts: store, publisher }, poolId),
    now: () => clock.t,
  });
  return { chain, custody, store, publisher, daemon, clock };
}

/** One pool type's account, by its coordinates (D-E19). */
async function typeOf(w: World, mode = 0, tier = 0, capacity = 64) {
  const t = (await w.chain.getPoolTypes()).find(
    (x) => x.mode === mode && x.tier === tier && x.capacity === capacity
  );
  if (!t) throw new Error(`no pool type ${mode}:${tier}:${capacity}`);
  return t;
}

/** Prompt v2 §B.6: a settled pool type reopens on the first tick AFTER its
 * cooldown (five minutes at launch) — never in the settling tick itself.
 * Advances the clock by exactly the cooldown and ticks. */
async function tickAfterCooldown(w: World) {
  w.clock.t += (await w.chain.getConfig()).cooldownSeconds;
  return w.daemon.tick();
}

/** Enter `n` players into an Open pool with real sealed ciphertexts, then
 * apply the program's post-entry transition (the seal at the pool's
 * capacity) exactly as `register` would. */
async function enterPlayers(w: World, poolId: bigint, n: number): Promise<string[]> {
  const key = w.chain.openedWith.get(poolId.toString());
  if (!key) throw new Error(`pool ${poolId} was never opened`);
  const entries = w.chain.entries.get(poolId.toString())!;
  const pool = w.chain.pools.get(poolId.toString())!;
  // The pool's recorded placing rule decides the payload's encoding and its
  // hash. An easy board (100 per battle) is also a valid hard one (700
  // across the board), so the same deterministic field serves both modes.
  const mode = boardModeOf(pool.mode);
  const players: string[] = [];
  for (let i = 0; i < n; i++) {
    const player = base58Encode(sha(`p:${poolId}:${entries.length}`));
    players.push(player);
    const payload: SealedPayload = {
      battles: battlesFor(entries.length * 100),
      salt: sha(`salt:${poolId}:${entries.length}`),
      timingsMs: [1000, 2000, 3000, 4000, 5000, 6000, 7000],
      deviceHash: sha(`device:${poolId}:${entries.length}`),
    };
    entries.push({
      player,
      index: entries.length,
      battlesHash: hex(battlesHash(payload.battles, payload.salt, mode)),
      flagged: false,
      refunded: false,
      settled: false,
      forfeited: false,
    });
    pool.entrants = entries.length;
    await w.store.put(poolId, player, seal(encodePayload(payload, mode), key.publicKey));
    w.chain.applyEntryTransitions(poolId);
  }
  return players;
}

/** The battle sets `enterPlayers` seats at indices 0..n-1, in seat order. */
const fieldOf = (n: number): BattleSet[] => Array.from({ length: n }, (_, i) => battlesFor(i * 100));

describe('the daemon (C8): keeper', () => {
  it('first tick opens one launch-complete pool for the open tier; second tick is a no-op', async () => {
    const w = await makeWorld();
    const r1 = await w.daemon.tick();
    expect(r1.errors).to.deep.equal([]);
    expect(r1.opened).to.deep.equal([{ poolId: 1n, tier: 0, mode: 0, capacity: 64 }]);
    expect(r1.completed).to.deep.equal([
      { poolId: 1n, step: 'pass_collection' },
      { poolId: 1n, step: 'vrf' },
    ]);
    const pool = await w.chain.getPool(1n);
    expect(pool.state).to.equal('Open');
    expect(pool.vrfCommitted).to.equal(true);
    expect(await w.chain.hasPassCollection(1n)).to.equal(true);
    expect((await typeOf(w)).activePool).to.equal(1n);

    const r2 = await w.daemon.tick();
    expect(r2.errors).to.deep.equal([]);
    expect(r2.opened).to.deep.equal([]);
    expect(r2.completed).to.deep.equal([]);
    expect((await w.chain.getConfig()).nextPoolId).to.equal(2n);
  });

  it('every open tier gets its own pool, ids gapless in tier order', async () => {
    const w = await makeWorld([
      [0, 0, 64],
      [0, 1, 64],
      [0, 2, 64],
    ]);
    w.chain.setOpenTiers([true, true, true, false, false, false, false]);
    const r = await w.daemon.tick();
    expect(r.errors).to.deep.equal([]);
    expect(r.opened).to.deep.equal([
      { poolId: 1n, tier: 0, mode: 0, capacity: 64 },
      { poolId: 2n, tier: 1, mode: 0, capacity: 64 },
      { poolId: 3n, tier: 2, mode: 0, capacity: 64 },
    ]);
    // D1: each pool carries its own tier's entry price.
    expect((await w.chain.getPool(2n)).entryLamports).to.equal(TIER_ENTRY_LAMPORTS[1]);
  });

  // Founder instruction 2026-09-12 §2: the tier switch still governs. The
  // test above enables three tiers to prove each gets its own pool; this one
  // proves the opposite — with six tiers shut, a settled pool is replaced by
  // exactly one more in the same tier, and a pool type enabled on a SHUT
  // tier never opens. A regression that read a type's own switch as enough
  // would pass the test above and fail here.
  it('with one tier open the crank replaces the tier-0 pool and opens nothing else', async function () {
    this.timeout(30000);
    const w = await makeWorld([
      [0, 0, 64],
      [0, 1, 64],
    ]);
    // `makeWorld` already seeds the launch bitmap; restated so the test says
    // what it depends on rather than inheriting it silently.
    w.chain.config!.openTiers = [true, false, false, false, false, false, false];

    const first = await w.daemon.tick();
    expect(first.opened).to.deep.equal([{ poolId: 1n, tier: 0, mode: 0, capacity: 64 }]);

    // Fill it, run it to Paid.
    await enterPlayers(w, 1n, 52);
    w.clock.t = (await w.chain.getPool(1n)).fillDeadline + 1n;
    const settled = await w.daemon.tick();
    expect(settled.errors).to.deep.equal([]);
    expect(settled.cranked).to.deep.equal([{ poolId: 1n, finalState: 'Paid' }]);
    // The slot frees at Paid, but the cooldown still holds this tick.
    expect(settled.opened).to.deep.equal([]);

    // Past the cooldown: one new pool, tier 0, and nothing in tiers 1-6
    // however much the treasury holds.
    const next = await tickAfterCooldown(w);
    expect(next.errors).to.deep.equal([]);
    expect(next.opened).to.deep.equal([{ poolId: 2n, tier: 0, mode: 0, capacity: 64 }]);
    expect((await w.chain.getConfig()).nextPoolId).to.equal(3n);
    expect((await w.chain.getPool(2n)).tier).to.equal(0);
  });

  it('a paused config holds the keeper (settlement is separate)', async () => {
    const w = await makeWorld();
    w.chain.config!.paused = true;
    const r = await w.daemon.tick();
    expect(r.opened).to.deep.equal([]);
    expect(r.errors).to.deep.equal([]);
    w.chain.config!.paused = false;
    expect((await w.daemon.tick()).opened).to.deep.equal([{ poolId: 1n, tier: 0, mode: 0, capacity: 64 }]);
  });
});

describe('the daemon (C8): the product loop', () => {
  it('seal -> crank to Paid -> the tier reopens after its cooldown', async function () {
    this.timeout(30000);
    const w = await makeWorld();
    await w.daemon.tick(); // opens pool 1
    await enterPlayers(w, 1n, 64); // fills and seals it (slot frees)

    const r = await w.daemon.tick();
    expect(r.errors).to.deep.equal([]);
    expect(r.cranked).to.deep.equal([{ poolId: 1n, finalState: 'Paid' }]);
    // Paid freed the slot and stamped the cooldown: nothing reopens yet.
    expect(r.opened).to.deep.equal([]);
    const cfg = await w.chain.getConfig();
    expect((await typeOf(w)).activePool).to.equal(0n);
    expect((await typeOf(w)).nextOpenAt).to.equal(w.clock.t + cfg.cooldownSeconds);
    const r2 = await tickAfterCooldown(w);
    expect(r2.opened).to.deep.equal([{ poolId: 2n, tier: 0, mode: 0, capacity: 64 }]);

    // Conservation: the paid set carries exactly the prize pool.
    let paid = 0n;
    for (const v of w.chain.paid.values()) paid += v;
    expect(paid).to.equal(POT_64);

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
    expect(r.opened).to.deep.equal([]); // Closed stamps the cooldown too
    for (const p of players) {
      expect(w.chain.paid.get(p)).to.equal(TIER_ENTRY_LAMPORTS[0]); // 100% back (R7)
    }
    expect((await tickAfterCooldown(w)).opened).to.deep.equal([{ poolId: 2n, tier: 0, mode: 0, capacity: 64 }]);
  });

  it('an empty pool past its deadline closes and is replaced', async () => {
    const w = await makeWorld();
    await w.daemon.tick();
    w.clock.t = (await w.chain.getPool(1n)).fillDeadline + 1n;
    const r = await w.daemon.tick();
    expect(r.errors).to.deep.equal([]);
    expect(r.refundsTriggered).to.deep.equal([1n]);
    expect((await w.chain.getPool(1n)).state).to.equal('Closed');
    expect(r.opened).to.deep.equal([]);
    expect((await tickAfterCooldown(w)).opened).to.deep.equal([{ poolId: 2n, tier: 0, mode: 0, capacity: 64 }]);
  });

  it('the cooldown holds the keeper to the second, then the tier reopens', async () => {
    const w = await makeWorld();
    await w.daemon.tick();
    w.clock.t = (await w.chain.getPool(1n)).fillDeadline + 1n;
    await w.daemon.tick(); // the empty pool closes; the cooldown starts
    const cfg = await w.chain.getConfig();
    expect(cfg.cooldownSeconds).to.equal(300n, 'DEFAULT_COOLDOWN_SECS');
    const nextOpenAt = (await typeOf(w)).nextOpenAt;
    expect(nextOpenAt).to.equal(w.clock.t + 300n);
    w.clock.t = nextOpenAt - 1n;
    const held = await w.daemon.tick();
    expect(held.opened).to.deep.equal([]);
    expect(held.errors).to.deep.equal([], 'a hold is a verdict, not a failed transaction');
    w.clock.t = nextOpenAt;
    expect((await w.daemon.tick()).opened).to.deep.equal([{ poolId: 2n, tier: 0, mode: 0, capacity: 64 }]);
  });

  it('the keeper gate: a stranger never opens a tier, however long it idles (O9b)', async () => {
    const w = await makeWorld();
    // The 24-hour liveness fallback was removed on 2026-09-07: a daemon
    // signing with anything but the keeper opens nothing, ever. A frozen
    // tier strands no money; a pool opened by a stranger would strand all
    // of it, because the opener chooses the sealing key.
    w.clock.t = 100_000n;
    w.chain.opener = 'stranger';
    const first = await w.daemon.tick();
    expect(first.opened).to.deep.equal([]);
    expect(first.errors.map((e) => e.message).join()).to.include('NotKeeper');
    for (const days of [1n, 30n, 365n]) {
      w.clock.t += days * 24n * 3600n;
      expect((await w.daemon.tick()).opened, `after ${days} day(s)`).to.deep.equal([]);
    }
    // The keeper opens immediately, whenever it likes.
    w.chain.opener = 'settle';
    expect((await w.daemon.tick()).opened).to.deep.equal([{ poolId: 1n, tier: 0, mode: 0, capacity: 64 }]);
    // And the cooldown still governs the keeper, exactly as before.
    w.clock.t = (await w.chain.getPool(1n)).fillDeadline + 1n;
    await w.daemon.tick(); // closes pool 1; the cooldown is stamped
    const nextOpenAt = (await typeOf(w)).nextOpenAt;
    w.clock.t = nextOpenAt - 1n;
    expect((await w.daemon.tick()).opened).to.deep.equal([], 'one second early');
    w.clock.t = nextOpenAt;
    expect((await w.daemon.tick()).opened).to.deep.equal([{ poolId: 2n, tier: 0, mode: 0, capacity: 64 }]);
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
  it('the deadline is twelve hours from open and no seat moves it (option A)', async () => {
    const w = await makeWorld();
    await w.daemon.tick(); // opens pool 1 at t = 1_000
    const opened = (await w.chain.getPool(1n)).fillDeadline;
    expect(opened).to.equal(1_000n + 12n * 3600n, 'DEFAULT_FILL_DEADLINE_SECS');
    expect((await w.chain.getConfig()).fillDeadlineSeconds).to.equal(12n * 3600n);

    await enterPlayers(w, 1n, 51);
    expect((await w.chain.getPool(1n)).fillDeadline).to.equal(opened, '51 seats: untouched');
    w.clock.t = 5_000n;
    await enterPlayers(w, 1n, 1); // the 52nd
    expect((await w.chain.getPool(1n)).fillDeadline).to.equal(opened, '52nd seat: untouched');
    expect((await w.chain.getPool(1n)).state).to.equal('Open');
    w.clock.t = 9_000n;
    await enterPlayers(w, 1n, 5);
    expect((await w.chain.getPool(1n)).fillDeadline).to.equal(opened, 'later seats: untouched');
  });

  it('set_pool_timing changes future pools only; an open pool keeps its deadline', async () => {
    const w = await makeWorld();
    await w.daemon.tick(); // pool 1 under 12 h
    const opened = (await w.chain.getPool(1n)).fillDeadline;
    w.chain.setPoolTiming(3600n, 60n);
    expect((await w.chain.getPool(1n)).fillDeadline).to.equal(opened, 'players entered under 12 h');
    w.chain.addPoolType(0, 1, 64);
    w.chain.setOpenTiers([true, true, false, false, false, false, false]);
    const r = await w.daemon.tick();
    expect(r.opened).to.deep.equal([{ poolId: 2n, tier: 1, mode: 0, capacity: 64 }]);
    expect((await w.chain.getPool(2n)).fillDeadline).to.equal(w.clock.t + 3600n);
    await expectRejects(async () => w.chain.setPoolTiming(0n, 60n), 'InvalidTiming');
  });

  it('a 52-seat pool — comfortably above the floor — seals at its deadline, cranks to Paid and the tier reopens after the cooldown', async function () {
    this.timeout(30000);
    const w = await makeWorld();
    await w.daemon.tick(); // opens pool 1
    await enterPlayers(w, 1n, 52);

    // Before the deadline: Open, nothing to do.
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
    expect(r.opened).to.deep.equal([]);
    expect((await tickAfterCooldown(w)).opened).to.deep.equal([{ poolId: 2n, tier: 0, mode: 0, capacity: 64 }]);

    // Conservation over the real 52-seat field: the paid set carries
    // exactly the prize pool, and nobody past the table's sixteen
    // positions is in it (D-E19).
    const pool = await w.chain.getPool(1n);
    expect(pool.entrants).to.equal(52);
    let total = 0n;
    for (const c of pool.payouts) total += c.amountLamports;
    expect(total).to.equal(POT_64);
    let paid = 0n;
    for (const v of w.chain.paid.values()) paid += v;
    expect(paid).to.equal(POT_64);
    // The seal turned the entries into revenue: nothing refundable remains
    // and the treasury holds the 52 entries less the pot it funded.
    expect((await w.chain.getConfig()).platformRefundable).to.equal(0n);
  });

  // Seat counts derived from the POOL's own floor, not repeated: R7-b moved
  // it from 52 to 40, and a hard-coded 51 went from "one below the floor"
  // to "eleven above it" without a word changing. Since D-E19 the floor is
  // per pool — `Pool.min_seats`, copied from its type at open.
  it('a 63-seat pool seals the same way; one seat below the floor refunds instead', async function () {
    this.timeout(30000);
    const w = await makeWorld();
    await w.daemon.tick(); // pool 1
    await enterPlayers(w, 1n, 63);
    w.clock.t = (await w.chain.getPool(1n)).fillDeadline + 1n;
    const r1 = await w.daemon.tick();
    expect(r1.errors).to.deep.equal([]);
    expect(r1.sealedAtDeadline).to.deep.equal([1n]);
    expect(r1.cranked).to.deep.equal([{ poolId: 1n, finalState: 'Paid' }]);
    expect((await tickAfterCooldown(w)).opened).to.deep.equal([{ poolId: 2n, tier: 0, mode: 0, capacity: 64 }]);

    const players = await enterPlayers(w, 2n, (await w.chain.getPool(2n)).minSeats - 1);
    w.clock.t = (await w.chain.getPool(2n)).fillDeadline + 1n;
    const r2 = await w.daemon.tick();
    expect(r2.errors).to.deep.equal([]);
    expect(r2.sealedAtDeadline).to.deep.equal([]);
    expect(r2.refundsTriggered).to.deep.equal([2n]);
    expect(r2.cranked).to.deep.equal([{ poolId: 2n, finalState: 'Closed' }]);
    for (const p of players) {
      expect(w.chain.paid.get(p)).to.equal(TIER_ENTRY_LAMPORTS[0]); // 100% back
    }
  });

  it('the seal is refused one below the floor and the refund is refused at it (the guards mirror the program)', async () => {
    const w = await makeWorld();
    await w.daemon.tick();
    await enterPlayers(w, 1n, (await w.chain.getPool(1n)).minSeats - 1);
    w.clock.t = (await w.chain.getPool(1n)).fillDeadline + 1n;
    await expectRejects(() => w.chain.sealAtDeadline(1n), 'FieldBelowMinimum');
    // (`enterPlayers` pushes entries directly, so a seat added past the
    // deadline is a test convenience `register` itself would refuse.)
    await enterPlayers(w, 1n, 1);
    await expectRejects(() => w.chain.triggerRefund(1n), 'FieldReached');
    await w.chain.sealAtDeadline(1n);
    expect((await w.chain.getPool(1n)).state).to.equal('Sealed');
  });
});

describe('the daemon (C8): escrow under the 2026-09-07 ruling (FakeChain mirror)', () => {
  it('a forfeit moves nothing; the share passes to the eligible tied player, never the treasury (a pre-Ladder pool)', async function () {
    this.timeout(30000);
    const w = await makeWorld();
    await w.daemon.tick(); // opens pool 1
    // `pay_next_place` serves one-place pools — every pool opened before
    // the Ladder, as `migrate_pool` records it (D-E19).
    makePreLadder(w.chain.pools.get('1')!);
    const players = await enterPlayers(w, 1n, 64); // seals
    const pot = POT_64;
    // Flag both tied winners, then commit a two-way tie for first under a
    // REAL results root (the next-place payout verifies against it).
    await w.chain.flagEntry(1n, players[0]);
    await w.chain.flagEntry(1n, players[1]);
    await w.chain.revealPoolSecret(1n, sha('secret'));
    const { leafBytes, merkleRoot, merkleProof } = await import('../../scoring/src');
    const { base58Decode } = await import('../../_shared/src/blotto-events');
    const leaves = players.map((p, seat) =>
      leafBytes({
        player: base58Decode(p),
        rank: seat < 2 ? 1 : 1 + seat,
        amountLamports: seat < 2 ? pot / 2n : 0n,
      })
    );
    await w.chain.commitResults(1n, merkleRoot(leaves), [
      { entryIndex: 0, amountLamports: pot / 2n },
      { entryIndex: 1, amountLamports: pot / 2n },
    ]);
    await w.chain.payPrizes(1n, [0, 1]);
    expect((await w.chain.getPool(1n)).state).to.equal('Paid');
    expect(w.chain.escrowed.get(players[0])).to.equal(pot / 2n);
    expect(w.chain.escrowed.get(players[1])).to.equal(pot / 2n);
    const platformBefore = w.chain.platform;

    // Review clears seat 0 (released) and upholds seat 1 (forfeited).
    await w.chain.releaseEscrow(1n, players[0]);
    await w.chain.forfeitEscrow(1n, players[1]);
    expect(w.chain.platform).to.equal(platformBefore, 'a forfeit moves nothing');
    expect(w.chain.escrowed.get(players[1])).to.equal(pot / 2n, 'the share is still held');
    expect(w.chain.forfeited.get(players[1])).to.equal(pot / 2n);
    await expectRejects(() => w.chain.releaseEscrow(1n, players[1]), 'EscrowForfeitedAlready');
    await expectRejects(() => w.chain.forfeitEscrow(1n, players[1]), 'EscrowForfeitedAlready');

    // Seat 1's share → seat 0, the cleared tied member (rank 1, lower seat,
    // no witnesses). A wrong rank or a forged proof is refused first.
    const proof0 = merkleProof(leaves, 0);
    await expectRejects(
      () => w.chain.payNextPlace(1n, players[1], players[0], 2, pot / 2n, proof0, 1, true, []),
      'InvalidMerkleProof'
    );
    await expectRejects(
      () =>
        w.chain.payNextPlace(1n, players[1], players[2], 3, 0n, merkleProof(leaves, 2), 1, true, [
          players[0],
        ]),
      'NextPlaceIneligible' // seat 0 is eligible: the share stays at first place
    );
    await expectRejects(
      () => w.chain.payNextPlace(1n, players[1], players[0], 1, pot / 2n, proof0, 2, true, []),
      'NextPlaceSplitMismatch' // the eligible first-place group is one seat
    );
    await w.chain.payNextPlace(1n, players[1], players[0], 1, pot / 2n, proof0, 1, true, []);
    expect(w.chain.paid.get(players[0])).to.equal(pot, 'released share + the forfeited share');
    expect(w.chain.escrowed.has(players[1])).to.equal(false);
    expect(w.chain.platform).to.equal(platformBefore, 'nothing reached the operator');
    await expectRejects(
      () => w.chain.payNextPlace(1n, players[1], players[0], 1, pot / 2n, proof0, 1, true, []),
      'NoEscrow'
    );
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
  it('the review clock: a flagged share still held at twelve hours is released, not a second before (Stage D)', async function () {
    this.timeout(60000);
    const w = await makeWorld();
    await w.daemon.tick(); // opens pool 1
    const players = await enterPlayers(w, 1n, 64); // seals
    // Flag every seat before settlement so whoever wins is paid INTO
    // escrow — the winner is the scoring engine's to decide, not the test's.
    for (const p of players) await w.chain.flagEntry(1n, p);
    const settledAt = w.clock.t;
    const r1 = await w.daemon.tick();
    expect(r1.errors).to.deep.equal([]);
    expect(r1.cranked).to.deep.equal([{ poolId: 1n, finalState: 'Paid' }]);
    expect(r1.released).to.deep.equal([], 'nothing releases in the settling tick');
    const held = [...w.chain.escrowed.entries()];
    expect(held.length).to.be.greaterThan(0, 'the winning share is held');
    let heldTotal = 0n;
    for (const [, v] of held) heldTotal += v;
    expect(heldTotal).to.equal(POT_64, 'the whole prize pool is under review');
    for (const [player] of held) {
      expect(w.chain.escrowedAt.get(player)).to.equal(settledAt, 'escrowed_at is the settlement instant');
    }

    // One second short of the window: still held, still resolving.
    w.clock.t = settledAt + REVIEW_WINDOW_SECS - 1n;
    const r2 = await w.daemon.tick();
    expect(r2.errors).to.deep.equal([]);
    expect(r2.released).to.deep.equal([]);
    expect(w.chain.escrowed.size).to.equal(held.length);

    // At the window: released to the players, the flag bit untouched (the
    // program refuses clear_flag on a settled entry — the escrow reaching
    // zero is the record), the pot conserved.
    w.clock.t = settledAt + REVIEW_WINDOW_SECS;
    const r3 = await w.daemon.tick();
    expect(r3.errors).to.deep.equal([]);
    expect(r3.released.map((x) => x.player).sort()).to.deep.equal(held.map(([p]) => p).sort());
    expect(w.chain.escrowed.size).to.equal(0);
    let paid = 0n;
    for (const [player, v] of w.chain.paid) {
      if (held.some(([p]) => p === player)) paid += v;
    }
    expect(paid).to.equal(POT_64);
    const after = await w.chain.getEntries(1n);
    for (const [player] of held) {
      const e = after.find((x) => x.player === player)!;
      expect(e.flagged).to.equal(true);
      expect(e.escrowLamports).to.equal(0n);
    }

    // Idempotent: the next tick has nothing left to release.
    const r4 = await w.daemon.tick();
    expect(r4.released).to.deep.equal([]);
    expect(r4.errors).to.deep.equal([]);
  });

  it('the review clock never touches a forfeited share (Stage D)', async function () {
    this.timeout(60000);
    const w = await makeWorld();
    await w.daemon.tick();
    const players = await enterPlayers(w, 1n, 64);
    for (const p of players) await w.chain.flagEntry(1n, p);
    const settledAt = w.clock.t;
    await w.daemon.tick();
    const held = [...w.chain.escrowed.keys()];
    expect(held.length).to.be.greaterThan(0);

    // Review upholds every held share: forfeited — in a Ladder pool held
    // in the vault until the cascade ships (D-E19) — and the clock must
    // leave each exactly where it is.
    for (const p of held) await w.chain.forfeitEscrow(1n, p);

    w.clock.t = settledAt + REVIEW_WINDOW_SECS + 24n * 3600n;
    const r = await w.daemon.tick();
    expect(r.errors).to.deep.equal([]);
    expect(r.released).to.deep.equal([], 'a forfeited share is never auto-released');
    expect(r.nextPlacePaid).to.deep.equal([], 'nor paid onward in a multi-place pool');
    for (const p of held) expect(w.chain.escrowed.get(p)).to.not.equal(undefined, 'still held');
    const r2 = await w.daemon.tick();
    expect(r2.errors).to.deep.equal([]);
    expect(r2.released).to.deep.equal([]);
  });

  it('the review clock: a failed release is a tick error and is retried next tick (Stage D)', async function () {
    this.timeout(60000);
    const w = await makeWorld();
    await w.daemon.tick();
    const players = await enterPlayers(w, 1n, 64);
    for (const p of players) await w.chain.flagEntry(1n, p);
    const settledAt = w.clock.t;
    await w.daemon.tick();
    const held = [...w.chain.escrowed.keys()];
    expect(held.length).to.be.greaterThan(0);

    // An RPC fault at the wrong moment: the first release throws.
    const real = w.chain.releaseEscrow.bind(w.chain);
    let failOnce = true;
    w.chain.releaseEscrow = async (poolId, player) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('rpc down');
      }
      return real(poolId, player);
    };

    w.clock.t = settledAt + REVIEW_WINDOW_SECS;
    const r1 = await w.daemon.tick();
    expect(r1.errors.map((e) => e.action)).to.include('settle');
    expect(w.chain.escrowed.size).to.be.greaterThan(0, 'the faulted share is still held');

    const r2 = await w.daemon.tick();
    expect(r2.errors).to.deep.equal([]);
    expect(w.chain.escrowed.size).to.equal(0, 'released on the retry');
    const releasedAll = [...r1.released, ...r2.released].map((x) => x.player).sort();
    expect(releasedAll).to.deep.equal(held.sort());
  });

  it('the next-place driver: an upheld flag on the winner pays the share to the next rank (O23, a pre-Ladder pool)', async function () {
    this.timeout(120000);
    // `pay_next_place` serves one-place pools — every pool opened before the
    // Ladder (D-E19) — so both passes settle one, as `migrate_pool` records it.
    // Pass 1: settle a pool naturally to learn who the scoring engine ranks
    // first. The field is deterministic (players are seeded by pool id and
    // index), so pass 2 reproduces it exactly.
    const probe = await makeWorld();
    await probe.daemon.tick();
    makePreLadder(probe.chain.pools.get('1')!);
    await enterPlayers(probe, 1n, 64);
    await probe.daemon.tick();
    const winnerSeat = (await probe.chain.getPool(1n)).payouts[0].entryIndex;

    // Pass 2: the same field, but the winner is flagged BEFORE settlement —
    // the only order the program allows (`flag_entry` refuses a settled
    // entry), and therefore the only way a prize is ever escrowed.
    const w = await makeWorld();
    await w.daemon.tick();
    makePreLadder(w.chain.pools.get('1')!);
    const players = await enterPlayers(w, 1n, 64);
    await w.chain.flagEntry(1n, players[winnerSeat]);
    const pot = POT_64;

    const r1 = await w.daemon.tick();
    expect(r1.errors).to.deep.equal([]);
    expect(r1.cranked).to.deep.equal([{ poolId: 1n, finalState: 'Paid' }]);
    expect(r1.nextPlacePaid).to.deep.equal([], 'nothing is forfeited yet');
    const winner = players[winnerSeat];
    expect(w.chain.escrowed.get(winner)).to.equal(pot, "the winner's prize is held");

    // Review upholds the flag. Nothing moves at forfeit — the share waits
    // here, and before this driver existed it waited forever.
    await w.chain.forfeitEscrow(1n, winner);
    expect(w.chain.escrowed.get(winner)).to.equal(pot, 'still held after the forfeit');
    const platformBefore = w.chain.platform;

    const r2 = await w.daemon.tick();
    expect(r2.errors).to.deep.equal([]);
    expect(r2.nextPlacePaid.length).to.be.greaterThan(0, 'the share moved on');
    for (const p of r2.nextPlacePaid) {
      expect(p.from).to.equal(winner);
      expect(p.to).to.not.equal(winner, 'never back to the forfeiter');
    }
    expect(w.chain.platform).to.equal(platformBefore, 'not one lamport to us');
    expect(w.chain.escrowed.get(winner) ?? 0n).to.equal(0n, 'the share is fully divided');
    expect(w.chain.paid.get(winner) ?? 0n).to.equal(0n, 'the forfeiter keeps nothing');

    // Conservation, and the published division: equally among the players at
    // the next rank, the indivisible remainder to the lowest entry number.
    let paid = 0n;
    for (const v of w.chain.paid.values()) paid += v;
    expect(paid).to.equal(pot, 'the pot is conserved to the lamport');

    const { recomputeRanking } = await import('../src/ranking');
    const ranking = await recomputeRanking(
      w.store,
      1n,
      await w.custody.exportSecret(1n),
      await w.chain.getEntries(1n),
      (await w.chain.getPool(1n)).entrants,
      { table: [Number(pot / TIER_ENTRY_LAMPORTS[0])], entryLamports: TIER_ENTRY_LAMPORTS[0] },
      (await w.chain.getPool(1n)).resultsRootHex
    );
    const atNextRank = ranking.rows.filter((r) => r.rank === 2);
    expect(r2.nextPlacePaid.map((p) => p.to).sort()).to.deep.equal(
      atNextRank.map((r) => r.player).sort()
    );
    const share = pot / BigInt(atNextRank.length);
    const remainder = pot - share * BigInt(atNextRank.length);
    const lowestSeat = Math.min(...atNextRank.map((r) => r.index));
    for (const r of atNextRank) {
      const expected = r.index === lowestSeat ? share + remainder : share;
      expect(w.chain.paid.get(r.player), `seat ${r.index}`).to.equal(expected);
    }

    // Idempotent: the pool is terminal now and nothing is carried twice.
    const r3 = await w.daemon.tick();
    expect(r3.errors).to.deep.equal([]);
    expect(r3.nextPlacePaid).to.deep.equal([]);
  });

  it('the sweep does not go terminal on a pool whose share is still held or forfeited (O23, a pre-Ladder pool)', async function () {
    this.timeout(120000);
    // The floor advances over a terminal PREFIX. A pool that settles with a
    // held share must therefore not read as terminal, or the sweep would
    // walk past it and never come back to carry the share onward.
    const probe = await makeWorld();
    await probe.daemon.tick();
    makePreLadder(probe.chain.pools.get('1')!);
    await enterPlayers(probe, 1n, 64);
    await probe.daemon.tick();
    const winnerSeat = (await probe.chain.getPool(1n)).payouts[0].entryIndex;

    const w = await makeWorld();
    await w.daemon.tick();
    makePreLadder(w.chain.pools.get('1')!);
    const players = await enterPlayers(w, 1n, 64);
    await w.chain.flagEntry(1n, players[winnerSeat]);
    await w.daemon.tick(); // settles; the prize is escrowed under the flag

    // Held: a second pool opens for the type, and pool 1 is still swept.
    await w.chain.forfeitEscrow(1n, players[winnerSeat]);
    const before = w.chain.escrowed.get(players[winnerSeat]);
    expect(before).to.equal(POT_64);
    const r = await w.daemon.tick();
    expect(r.nextPlacePaid.length).to.be.greaterThan(0, 'the sweep came back to pool 1');
  });

  it('a key created before the crash is republished, never regenerated', async () => {
    const w = await makeWorld();
    // The crash window: createPoolKey succeeded, open_pool never landed.
    const created = await w.custody.createPoolKey(1n);

    const r = await w.daemon.tick(); // a fresh daemon (no memory of the key)
    expect(r.errors).to.deep.equal([]);
    expect(r.opened).to.deep.equal([{ poolId: 1n, tier: 0, mode: 0, capacity: 64 }]);
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
    await w.chain.openPool(1n, 0, key.publicKey, key.secretHash, 0, 64);

    const r = await w.daemon.tick();
    expect(r.errors).to.deep.equal([]);
    expect(r.opened).to.deep.equal([]); // no duplicate open
    expect(r.completed).to.deep.equal([
      { poolId: 1n, step: 'pass_collection' },
      { poolId: 1n, step: 'vrf' },
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
      ciphertexts: w.store,
      vrf: flaky,
      crank: (id) =>
        crankPool(
          { chain: w.chain, custody: w.custody, ciphertexts: w.store, publisher: w.publisher },
          id
        ),
      now: () => w.clock.t,
    });

    const r1 = await daemon.tick();
    expect(r1.opened).to.deep.equal([{ poolId: 1n, tier: 0, mode: 0, capacity: 64 }]);
    expect(r1.errors.length).to.equal(1);
    expect(r1.errors[0].action).to.equal('keeper');
    expect((await w.chain.getPool(1n)).vrfCommitted).to.equal(false);
    // The failing oracle no longer holds the collection back (R22): entries
    // need the collection, not the seed.
    expect(r1.completed).to.deep.equal([{ poolId: 1n, step: 'pass_collection' }]);
    expect(await w.chain.hasPassCollection(1n)).to.equal(true);

    const r2 = await daemon.tick();
    expect(r2.errors).to.deep.equal([]);
    expect(r2.completed).to.deep.equal([{ poolId: 1n, step: 'vrf' }]);
  });

  it('with no coordinator (R22) a pool launches with its collection and no seed, cleanly', async () => {
    const w = await makeWorld();
    const daemon = makeDaemon({
      chain: w.chain,
      custody: w.custody,
      ciphertexts: w.store,
      vrf: null,
      crank: (id) =>
        crankPool(
          { chain: w.chain, custody: w.custody, ciphertexts: w.store, publisher: w.publisher },
          id
        ),
      now: () => w.clock.t,
    });

    const r1 = await daemon.tick();
    expect(r1.errors).to.deep.equal([]);
    expect(r1.opened).to.deep.equal([{ poolId: 1n, tier: 0, mode: 0, capacity: 64 }]);
    expect(r1.completed).to.deep.equal([{ poolId: 1n, step: 'pass_collection' }]);
    expect((await w.chain.getPool(1n)).vrfCommitted).to.equal(false);
    expect(await w.chain.hasPassCollection(1n)).to.equal(true);

    // Nothing left to do on the next tick, and nothing reported as failing.
    const r2 = await daemon.tick();
    expect(r2.errors).to.deep.equal([]);
    expect(r2.completed).to.deep.equal([]);
  });

  it('never attempts a seed once the pool has an entrant (the program refuses it, R22)', async () => {
    const w = await makeWorld();
    let attempts = 0;
    const counting = {
      commitSeed: async (poolId: bigint) => {
        attempts++;
        await w.chain.commitVrfSeed(poolId, 'stub');
      },
    };
    const daemon = makeDaemon({
      chain: w.chain,
      custody: w.custody,
      ciphertexts: w.store,
      vrf: counting,
      crank: (id) =>
        crankPool(
          { chain: w.chain, custody: w.custody, ciphertexts: w.store, publisher: w.publisher },
          id
        ),
      now: () => w.clock.t,
    });
    // The crash window again, but an entry landed before any seed did.
    const key = await w.custody.createPoolKey(1n);
    await w.chain.openPool(1n, 0, key.publicKey, key.secretHash, 0, 64);
    w.chain.pools.get('1')!.entrants = 1;

    const r = await daemon.tick();
    expect(r.errors).to.deep.equal([]);
    expect(r.completed).to.deep.equal([{ poolId: 1n, step: 'pass_collection' }]);
    expect(attempts).to.equal(0);
  });
});

describe('the daemon (C8): double-run', () => {
  it('two daemons over one chain never double-open a tier', async () => {
    const w = await makeWorld();
    const second = makeDaemon({
      chain: w.chain,
      custody: w.custody,
      ciphertexts: w.store,
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
    expect((await typeOf(w)).activePool).to.equal(1n);
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
      ciphertexts: w.store,
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
    let paid = 0n;
    for (const v of w.chain.paid.values()) paid += v;
    for (const v of w.chain.escrowed.values()) paid += v;
    expect(paid).to.equal(POT_64);
    // And, after the cooldown, the tier has exactly one successor — even
    // with both daemons ticking.
    w.clock.t += (await w.chain.getConfig()).cooldownSeconds;
    await Promise.all([w.daemon.tick(), second.tick()]);
    expect((await w.chain.getConfig()).nextPoolId).to.equal(3n);
    expect((await typeOf(w)).activePool).to.equal(2n);
  });
});

/**
 * A backstop for the counted run-loop tests below.
 *
 * Those tests stop the loop from inside `afterIteration`, which is exactly
 * the right condition to assert on — but it means a defect in the loop that
 * skipped that hook would leave `run()` looping for ever, and a HANG is a
 * worse failure than a red: mocha reports the timeout but the pending loop
 * keeps the process alive. This arms an unreferenced timer that aborts
 * regardless, so a broken loop still terminates; the iteration-count
 * assertion in each test is what then reports it, because the backstop fires
 * at a different count from the one the test expects.
 */
function failsafe(ac: AbortController, ms = 5_000): () => void {
  const t = setTimeout(() => ac.abort(), ms);
  (t as unknown as { unref?: () => void }).unref?.();
  return () => clearTimeout(t);
}

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
      ciphertexts: w.store,
      vrf: new StubVrfCoordinator(w.chain, 'stub'),
      crank: async (id) => ({ poolId: id, finalState: 'Paid', stepsTaken: [] }),
      now: () => w.clock.t,
    });
    // COUNTED, NOT TIMED (audit 2026-09-11, G-18). This used to start the
    // loop, sleep 40ms of WALL CLOCK, abort, and then assert that more than
    // two ticks had happened — which is a guess about how many 5ms intervals a
    // loaded CI runner fits into 40ms. A slow runner failed a correct
    // daemon; a fast one passed a loop that had stopped after tick three.
    // The loop is now stopped by the ITERATION COUNT it is being asserted
    // on, so the assertion and the stopping condition are the same fact.
    const ac = new AbortController();
    const stop = failsafe(ac);
    let iterations = 0;
    const done = daemon.run(1, ac.signal, {
      afterIteration: () => {
        if (++iterations >= 4) ac.abort();
      },
    });
    await done;
    stop();
    expect(ac.signal.aborted, 'the loop ran to the iteration count and stopped').to.equal(true);
    expect(iterations).to.equal(4);
    expect(ticks).to.be.greaterThan(2); // survived the first (failing) tick
  });

  // Audit 2026-09-11, A-23: `run` is the ONLY loop. It used to be dead in
  // production because main.ts carried a second, hand-written one for the per-tick work
  // below; these hooks are that work, so the tested loop is the live loop.
  it('run() drives the per-iteration hooks the deployment entry needs', async () => {
    const w = await makeWorld();
    const order: string[] = [];
    // Counted in `beforeTick`, so the failure lands on a whole ITERATION
    // rather than on the nth call of a method a tick may make more than once.
    let iteration = 0;
    const chain = new Proxy(w.chain, {
      get(target, prop, receiver) {
        if (prop === 'getConfig') {
          return async () => {
            // The second iteration throws: the error path must reach
            // onTickError, must NOT reach afterTick, and must still reach
            // afterIteration.
            if (iteration === 2) throw new Error('rpc down');
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
      ciphertexts: w.store,
      vrf: new StubVrfCoordinator(w.chain, 'stub'),
      crank: async (id) => ({ poolId: id, finalState: 'Paid', stepsTaken: [] }),
      now: () => w.clock.t,
    });
    const reports: TickReport[] = [];
    const errors: unknown[] = [];
    const ac = new AbortController();
    const stop = failsafe(ac);
    const done = daemon.run(1, ac.signal, {
      beforeTick: () => {
        iteration++;
        order.push('before');
      },
      afterTick: (report) => {
        order.push('after');
        reports.push(report);
      },
      onTickError: (e) => {
        order.push('error');
        errors.push(e);
      },
      // Counted, not timed (G-18): four iterations is what the assertions
      // below read — a clean one, the failing one, and two more that prove
      // the loop kept going — so four iterations is what stops it.
      afterIteration: () => {
        order.push('iteration');
        if (iteration >= 4) ac.abort();
      },
    });
    await done;
    stop();

    // A clean iteration is before → after → iteration, in that order.
    expect(order.slice(0, 3)).to.deep.equal(['before', 'after', 'iteration']);
    // The failing one is before → error → iteration: no report, and the
    // liveness hook still runs.
    expect(order.slice(3, 6)).to.deep.equal(['before', 'error', 'iteration']);
    expect(errors.length).to.equal(1);
    expect(String(errors[0])).to.contain('rpc down');
    // The loop kept going after the failure, and every report it handed back
    // is a real tick report.
    expect(iteration).to.equal(4);
    expect(reports.length, 'three clean iterations of the four').to.equal(3);
    for (const r of reports) expect(r.errors).to.be.an('array');
  });

  it('run() survives a hook that throws — book-keeping never stops the sweep', async () => {
    const w = await makeWorld();
    let iterations = 0;
    const ac = new AbortController();
    const stop = failsafe(ac);
    const done = w.daemon.run(1, ac.signal, {
      afterTick: () => {
        throw new Error('health write failed');
      },
      afterIteration: () => {
        // Counted, not timed (G-18). The abort is raised BEFORE the throw,
        // so the loop is stopped by a hook that then fails — which is the
        // property under test: a book-keeping hook that throws must stop
        // neither the iteration nor the sweep.
        if (++iterations >= 4) ac.abort();
        throw new Error('alert sink down');
      },
    });
    await done;
    stop();
    expect(iterations).to.equal(4);
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
      sealingSecretHash: Uint8Array,
      mode: number,
      capacity: number
    ): Promise<void> {
      this.meter();
      return super.openPool(poolId, tier, sealingPubkey, sealingSecretHash, mode, capacity);
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
      keeper: 'settle',
      vaultCeilingLamports: TIER_ENTRY_LAMPORTS.map((e) => e * 64n),
      treasuryMinPlatformLamports: 0n,
    });
    chain.addPoolType(0, 0, 64);
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
      ciphertexts: store,
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
    expect(report.opened).to.deep.equal([{ poolId: 1n, tier: 0, mode: 0, capacity: 64 }]);
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
      ciphertexts: w.store,
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
    w.clock.t += (await w.chain.getConfig()).cooldownSeconds;
    await daemon.tick(); // reopens the tier as pool 2
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
      ciphertexts: w.store,
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

    // Settlement finished despite the announce failure (and the tier
    // reopens after its cooldown as usual).
    expect(r.cranked).to.deep.equal([{ poolId: 1n, finalState: 'Paid' }]);
    expect(r.errors).to.have.length(1);
    expect(r.errors[0].action).to.equal('announce_bundle');
    expect(r.errors[0].poolId).to.equal('1');
  });
});

/*
 * Two holds the review clock must leave alone, and the bundle a Paid pool
 * still owes (2026-09-12, audit 2026-09-11: B-30 / C-10 / C-23 / D-26, D-03,
 * C-09 / B-32 / D-27).
 */
class RecordingMonitor {
  readonly events: { name: string; labels?: Record<string, string> }[] = [];
  readonly alerts: { reason: string; detail: Record<string, unknown> }[] = [];
  recordEvent(name: string, labels?: Record<string, string>): void {
    this.events.push({ name, labels });
  }
  reportGauge(): void {}
  alert(reason: string, detail: Record<string, unknown>): void {
    this.alerts.push({ reason, detail });
  }
  count(name: string, labels?: Record<string, string>): number {
    return this.events.filter(
      (e) =>
        e.name === name &&
        (!labels || Object.entries(labels).every(([k, v]) => e.labels?.[k] === v))
    ).length;
  }
}

describe('the daemon (C8): the review clock leaves two holds alone (2026-09-12)', () => {
  it('a flagged share under a sanctions hold is neither released nor a tick error, and the pool stays non-terminal until the hold is lifted', async function () {
    this.timeout(60000);
    const w = await makeWorld();
    const monitor = new RecordingMonitor();
    const daemon = makeDaemon({
      chain: w.chain,
      custody: w.custody,
      ciphertexts: w.store,
      vrf: new StubVrfCoordinator(w.chain, base58Encode(sha('randomness'))),
      crank: (poolId) =>
        crankPool({ chain: w.chain, custody: w.custody, ciphertexts: w.store, publisher: w.publisher }, poolId),
      now: () => w.clock.t,
      monitor,
    });
    await daemon.tick();
    const players = await enterPlayers(w, 1n, 64);
    // Every seat flagged AND held: whoever wins is paid into escrow under
    // both. Before 2026-09-12 the clock then threw SanctionsHoldActive on
    // every tick for ever once the window passed.
    for (const p of players) {
      await w.chain.flagEntry(1n, p);
      await w.chain.placeSanctionsHold(1n, p);
    }
    const settledAt = w.clock.t;
    const r1 = await daemon.tick();
    expect(r1.errors).to.deep.equal([]);
    expect(r1.cranked).to.deep.equal([{ poolId: 1n, finalState: 'Paid' }]);
    const held = [...w.chain.escrowed.keys()];
    expect(held.length).to.be.greaterThan(0);

    w.clock.t = settledAt + REVIEW_WINDOW_SECS + 3600n;
    const r2 = await daemon.tick();
    expect(r2.errors).to.deep.equal([], 'no throw: the clock never calls release_escrow on a held share');
    expect(r2.released).to.deep.equal([]);
    expect(r2.held.map((h) => h.reason)).to.deep.equal(held.map(() => 'sanctions_hold'));
    expect(monitor.count(METRIC.reveal.releaseHeld, { reason: 'sanctions_hold' })).to.equal(held.length);
    for (const p of held) expect(w.chain.escrowed.get(p)).to.not.equal(undefined, 'still held');

    // Still not terminal: the next tick looks again (and still does nothing).
    const r3 = await daemon.tick();
    expect(r3.held.length).to.equal(held.length);
    expect(r3.errors).to.deep.equal([]);

    // The admin lifts the hold; the clock releases on the next tick.
    for (const p of held) await w.chain.liftSanctionsHold(1n, p);
    const r4 = await daemon.tick();
    expect(r4.errors).to.deep.equal([]);
    expect(r4.held).to.deep.equal([]);
    expect(r4.released.map((x) => x.player).sort()).to.deep.equal([...held].sort());
    expect(w.chain.escrowed.size).to.equal(0);
  });

  it('a forfeit already in the decision log is never released by the clock; the alert fires once the window passes unlanded; the next-place step pays once the forfeit lands (D-03)', async function () {
    this.timeout(120000);
    // Pass 1: learn the winning seat (deterministic field). Both passes
    // settle a one-place (pre-Ladder) pool, the shape `pay_next_place`
    // serves (D-E19).
    const probe = await makeWorld();
    await probe.daemon.tick();
    makePreLadder(probe.chain.pools.get('1')!);
    await enterPlayers(probe, 1n, 64);
    await probe.daemon.tick();
    const winnerSeat = (await probe.chain.getPool(1n)).payouts[0].entryIndex;

    // Pass 2: the winner is flagged before settlement, and the review
    // service has LOGGED a forfeit that the multisig has not yet landed.
    const w = await makeWorld();
    const monitor = new RecordingMonitor();
    const forfeitLogged = new Set<string>();
    const daemon = makeDaemon({
      chain: w.chain,
      custody: w.custody,
      ciphertexts: w.store,
      vrf: new StubVrfCoordinator(w.chain, base58Encode(sha('randomness'))),
      crank: (poolId) =>
        crankPool({ chain: w.chain, custody: w.custody, ciphertexts: w.store, publisher: w.publisher }, poolId),
      now: () => w.clock.t,
      decisions: { forfeitLogged: async (_pool, player) => forfeitLogged.has(player) },
      monitor,
    });
    await daemon.tick();
    makePreLadder(w.chain.pools.get('1')!);
    const players = await enterPlayers(w, 1n, 64);
    const winner = players[winnerSeat];
    await w.chain.flagEntry(1n, winner);
    const settledAt = w.clock.t;
    const r1 = await daemon.tick();
    expect(r1.errors).to.deep.equal([]);
    expect(w.chain.escrowed.get(winner)).to.equal(POT_64, "the winner's prize is held");
    forfeitLogged.add(winner);

    // Inside the window: held, no alert yet (the multisig is not late).
    w.clock.t = settledAt + REVIEW_WINDOW_SECS - 1n;
    const r2 = await daemon.tick();
    expect(r2.released).to.deep.equal([]);
    expect(r2.held).to.deep.equal([{ poolId: 1n, player: winner, reason: 'forfeit_logged' }]);
    expect(monitor.alerts).to.deep.equal([]);

    // Past the window: STILL held — before 2026-09-12 this tick paid the
    // flagged player — and the alert says the on-chain forfeit is late.
    w.clock.t = settledAt + REVIEW_WINDOW_SECS + 60n;
    const r3 = await daemon.tick();
    expect(r3.errors).to.deep.equal([]);
    expect(r3.released).to.deep.equal([], 'a logged forfeit is never auto-released');
    expect(w.chain.escrowed.get(winner)).to.equal(POT_64);
    expect(monitor.alerts.map((a) => a.reason)).to.deep.equal([ALERT.reveal.forfeitUnlanded]);
    expect(monitor.alerts[0].detail).to.include({ poolId: '1', player: winner });

    // The multisig lands the forfeit: the share moves on to the next rank.
    await w.chain.forfeitEscrow(1n, winner);
    const platformBefore = w.chain.platform;
    const r4 = await daemon.tick();
    expect(r4.errors).to.deep.equal([]);
    expect(r4.held).to.deep.equal([]);
    expect(r4.nextPlacePaid.length).to.be.greaterThan(0, 'the share moved on');
    expect(w.chain.platform).to.equal(platformBefore, 'not one lamport to us');
  });
});

describe('the daemon (C8): a Paid pool still owes its bundle (2026-09-12)', () => {
  it('a publish that failed after payment is retried on a backoff through the publish-only path, alerted after repeated failure, and announced when it lands', async function () {
    this.timeout(60000);
    const w = await makeWorld();
    const monitor = new RecordingMonitor();
    const published = new MemoryPublishedBundleStore();
    // The crank pays but its upload fails: exactly the case that used to
    // leave a Paid pool unverifiable for ever.
    const failing = { publish: async () => { throw new Error('irys down'); } };
    let owedCalls = 0;
    let owedFailuresLeft = 3;
    const announced: string[] = [];
    let wall = 1_000_000;
    const daemon = makeDaemon({
      chain: w.chain,
      custody: w.custody,
      ciphertexts: w.store,
      vrf: new StubVrfCoordinator(w.chain, base58Encode(sha('randomness'))),
      crank: (poolId) =>
        crankPool({ chain: w.chain, custody: w.custody, ciphertexts: w.store, publisher: failing }, poolId),
      now: () => w.clock.t,
      nowMs: () => wall,
      publishRetryMs: 10_000,
      published,
      publishOwed: async (poolId) => {
        owedCalls++;
        if (owedFailuresLeft > 0) {
          owedFailuresLeft--;
          throw new Error('irys still down');
        }
        const uri = `memory://owed/${poolId}`;
        await published.record(poolId, uri, w.clock.t);
        return uri;
      },
      announceBundle: async (_poolId, uri) => { announced.push(uri); },
      monitor,
    });
    await daemon.tick();
    await enterPlayers(w, 1n, 64);

    // The settling tick: paid, publish failed, the owed pass tries once.
    const r1 = await daemon.tick();
    expect(r1.cranked).to.deep.equal([{ poolId: 1n, finalState: 'Paid' }]);
    expect(owedCalls).to.equal(1);
    expect(r1.errors.map((e) => e.action)).to.deep.equal(['publish_owed']);
    expect(r1.published).to.deep.equal([]);

    // Inside the backoff: no attempt, still non-terminal.
    await daemon.tick();
    expect(owedCalls).to.equal(1, 'not every fifteen seconds');

    // Two more failures across the backoff: the alert fires on the third.
    wall += 10_000;
    await daemon.tick();
    expect(owedCalls).to.equal(2);
    expect(monitor.alerts).to.deep.equal([]);
    wall += 10_000;
    await daemon.tick();
    expect(owedCalls).to.equal(3);
    expect(monitor.alerts.map((a) => a.reason)).to.deep.equal([ALERT.reveal.bundleUnpublished]);
    expect(monitor.count(METRIC.reveal.bundlePublishFailed)).to.equal(3);

    // Then it lands: recorded, reported, announced — and the pool is done.
    wall += 10_000;
    const r5 = await daemon.tick();
    expect(owedCalls).to.equal(4);
    expect(r5.errors).to.deep.equal([]);
    expect(r5.published).to.deep.equal([{ poolId: 1n, uri: 'memory://owed/1' }]);
    expect(announced).to.deep.equal(['memory://owed/1']);
    expect(await published.find(1n)).to.equal('memory://owed/1');
    expect(monitor.count(METRIC.reveal.bundlePublished)).to.equal(1);
    wall += 10_000;
    await daemon.tick();
    expect(owedCalls).to.equal(4, 'a recorded bundle is never re-uploaded');
  });
});

/*
 * THE LADDER, END TO END (D-E19, founder ruling 2026-11-04/05): eight pool
 * types at launch — both modes × 8, 16, 32 and 64 players at tier 0 — each
 * with its own slot, cooldown, minimum field and fixed table. The keeper
 * opens all of them; each settles on its own table; a forfeited share in a
 * multi-place pool is held, never paid onward.
 */
describe('the daemon (D-E19): the Ladder end to end', () => {
  /** Every launch type's opened entry, in the policy's order. */
  const launchOrder = () =>
    LAUNCH_TYPES.map(([mode, tier, capacity]) => ({ mode, tier, capacity }))
      .sort((a, b) => a.tier - b.tier || a.mode - b.mode || a.capacity - b.capacity)
      .map((t, i) => ({ poolId: BigInt(i + 1), tier: t.tier, mode: t.mode, capacity: t.capacity }));

  it('the launch posture: eight pool types open at once, each launch-complete; the next tick is a no-op', async () => {
    const w = await makeWorld(LAUNCH_TYPES);
    const r = await w.daemon.tick();
    expect(r.errors).to.deep.equal([]);
    expect(r.opened).to.deep.equal(launchOrder());
    expect(r.completed).to.deep.equal(
      launchOrder().flatMap((o) => [
        { poolId: o.poolId, step: 'pass_collection' },
        { poolId: o.poolId, step: 'vrf' },
      ])
    );
    for (const o of launchOrder()) {
      const p = await w.chain.getPool(o.poolId);
      const table = ladderTable(o.capacity);
      expect([p.mode, p.capacity, p.minSeats, p.paidPlaces], `pool ${o.poolId}`).to.deep.equal([
        o.mode,
        o.capacity,
        minFieldFor(o.capacity),
        table.length,
      ]);
      expect(p.potLamports).to.equal(prizePoolFor(table, TIER_ENTRY_LAMPORTS[0]));
      expect((await typeOf(w, o.mode, 0, o.capacity)).activePool).to.equal(o.poolId);
    }
    const r2 = await w.daemon.tick();
    expect(r2.errors).to.deep.equal([]);
    expect(r2.opened).to.deep.equal([]);
    expect(r2.completed).to.deep.equal([]);
    expect((await w.chain.getConfig()).nextPoolId).to.equal(9n);
  });

  it('every size fills to its capacity, seals, settles on its own table to the lamport, and its type reopens', async function () {
    this.timeout(60000);
    const w = await makeWorld(LAUNCH_TYPES);
    await w.daemon.tick();
    for (const o of launchOrder()) {
      await enterPlayers(w, o.poolId, o.capacity);
      expect((await w.chain.getPool(o.poolId)).state, `pool ${o.poolId} seals at ${o.capacity}`).to.equal('Sealed');
    }
    const platformBefore = w.chain.platform;
    const r = await w.daemon.tick();
    expect(r.errors).to.deep.equal([]);
    expect(r.cranked).to.deep.equal(launchOrder().map((o) => ({ poolId: o.poolId, finalState: 'Paid' })));
    // Settlement moves nothing into or out of the treasury.
    expect(w.chain.platform).to.equal(platformBefore);

    for (const o of launchOrder()) {
      const pool = await w.chain.getPool(o.poolId);
      const table = ladderTable(o.capacity);
      const entry = TIER_ENTRY_LAMPORTS[0];
      const mode = boardModeOf(o.mode);
      // The committed list is exactly the engine's nonzero amounts over the
      // pool's table and entry price (D3-B ties included)…
      const engine = assignPrizes(scorePool(fieldOf(o.capacity), mode), table, entry);
      expect(pool.payouts, `pool ${o.poolId}`).to.deep.equal(
        engine
          .filter((x) => x.amountLamports > 0n)
          .sort((a, b) => a.index - b.index)
          .map((x) => ({ entryIndex: x.index, amountLamports: x.amountLamports }))
      );
      expect(pool.payouts.length, `${o.capacity} pays at least its ${table.length} places`).to.be.at.least(table.length);
      // …and the paid set carries exactly the prize pool.
      const players = (await w.chain.getEntries(o.poolId)).map((e) => e.player);
      let paid = 0n;
      for (const p of players) paid += w.chain.paid.get(p) ?? 0n;
      expect(paid, `pool ${o.poolId}`).to.equal(prizePoolFor(table, entry));
      expect(paid).to.equal(pool.potLamports);
      // The bundle names the terms (version 4).
      const bundle = [...w.publisher.published.values()].find((b) => b.pool_id === o.poolId.toString())!;
      expect([bundle.version, bundle.capacity, bundle.paid_places, bundle.min_seats]).to.deep.equal([
        4,
        o.capacity,
        table.length,
        minFieldFor(o.capacity),
      ]);
      expect(bundle.prize_table).to.deep.equal([...table]);
      expect(bundle.mode).to.equal(mode);
    }

    // Each type's slot freed at Paid; after the cooldown all eight reopen.
    const next = await tickAfterCooldown(w);
    expect(next.errors).to.deep.equal([]);
    expect(next.opened.map((o) => o.capacity)).to.deep.equal(launchOrder().map((o) => o.capacity));
    expect(next.opened.map((o) => o.poolId)).to.deep.equal(launchOrder().map((o) => o.poolId + 8n));
  });

  it('the minimum field per size: at it the pool seals and pays its table; one below it refunds in full', async function () {
    this.timeout(60000);
    const easy = LAUNCH_TYPES.filter(([mode]) => mode === 0);
    const w = await makeWorld(easy);
    const r0 = await w.daemon.tick();
    expect(r0.opened.map((o) => o.capacity)).to.deep.equal([8, 16, 32, 64]);
    for (const o of r0.opened) {
      // The POOL's own floor, copied from its type at open.
      expect((await w.chain.getPool(o.poolId)).minSeats).to.equal(minFieldFor(o.capacity));
      await enterPlayers(w, o.poolId, minFieldFor(o.capacity));
    }
    w.clock.t = (await w.chain.getPool(1n)).fillDeadline + 1n;
    const r1 = await w.daemon.tick();
    expect(r1.errors).to.deep.equal([]);
    expect(r1.sealedAtDeadline).to.deep.equal([1n, 2n, 3n, 4n]);
    expect(r1.refundsTriggered).to.deep.equal([]);
    expect(r1.cranked.map((c) => c.finalState)).to.deep.equal(['Paid', 'Paid', 'Paid', 'Paid']);
    for (const o of r0.opened) {
      const pool = await w.chain.getPool(o.poolId);
      expect(pool.entrants).to.equal(minFieldFor(o.capacity));
      let total = 0n;
      for (const c of pool.payouts) total += c.amountLamports;
      expect(total, `the ${o.capacity}-player table, paid in full at its minimum field`).to.equal(pool.potLamports);
    }

    const r2 = await tickAfterCooldown(w);
    expect(r2.opened.map((o) => o.capacity)).to.deep.equal([8, 16, 32, 64]);
    const below = new Map<bigint, string[]>();
    for (const o of r2.opened) {
      below.set(o.poolId, await enterPlayers(w, o.poolId, minFieldFor(o.capacity) - 1));
    }
    w.clock.t = (await w.chain.getPool(r2.opened[0].poolId)).fillDeadline + 1n;
    const r3 = await w.daemon.tick();
    expect(r3.errors).to.deep.equal([]);
    expect(r3.sealedAtDeadline).to.deep.equal([]);
    expect(r3.refundsTriggered).to.deep.equal(r2.opened.map((o) => o.poolId));
    expect(r3.cranked.map((c) => c.finalState)).to.deep.equal(['Closed', 'Closed', 'Closed', 'Closed']);
    for (const players of below.values()) {
      for (const p of players) expect(w.chain.paid.get(p)).to.equal(TIER_ENTRY_LAMPORTS[0]); // 100% back (R7)
    }
    for (const o of r2.opened) {
      // The type's slot freed at Closed and its cooldown is stamped.
      const t = await typeOf(w, 0, 0, o.capacity);
      expect(t.activePool).to.equal(0n);
      expect(t.nextOpenAt).to.equal(w.clock.t + (await w.chain.getConfig()).cooldownSeconds);
    }
  });

  it('a Ladder pool with an upheld flag: the share is HELD in its vault, never paid onward, said once', async function () {
    this.timeout(60000);
    const w = await makeWorld([[0, 0, 8]]);
    const monitor = new RecordingMonitor();
    const steps: string[] = [];
    let nextPlaceCalls = 0;
    const real = w.chain.payNextPlace.bind(w.chain);
    w.chain.payNextPlace = async (...args: Parameters<FakeChain['payNextPlace']>) => {
      nextPlaceCalls++;
      return real(...args);
    };
    const daemon = makeDaemon({
      chain: w.chain,
      custody: w.custody,
      ciphertexts: w.store,
      vrf: new StubVrfCoordinator(w.chain, base58Encode(sha('randomness'))),
      crank: (poolId) =>
        crankPool({ chain: w.chain, custody: w.custody, ciphertexts: w.store, publisher: w.publisher }, poolId),
      now: () => w.clock.t,
      monitor,
      log: (step) => steps.push(step),
    });
    await daemon.tick();
    const players = await enterPlayers(w, 1n, 8); // fills and seals
    // Every seat flagged before settlement: whoever the table pays is paid
    // INTO escrow — the winners are the engine's to decide, not the test's.
    for (const p of players) await w.chain.flagEntry(1n, p);
    const r1 = await daemon.tick();
    expect(r1.errors).to.deep.equal([]);
    expect(r1.cranked).to.deep.equal([{ poolId: 1n, finalState: 'Paid' }]);
    const held = [...w.chain.escrowed.keys()];
    expect(held.length, 'the 8-player table pays two places (or a tie)').to.be.at.least(2);

    // Review upholds every flag. Nothing moves at forfeit.
    for (const p of held) await w.chain.forfeitEscrow(1n, p);
    const escrowBefore = new Map(w.chain.escrowed);
    const platformBefore = w.chain.platform;

    const r2 = await daemon.tick();
    expect(r2.errors).to.deep.equal([]);
    expect(r2.nextPlacePaid).to.deep.equal([]);
    expect(nextPlaceCalls, 'pay_next_place is never called for a multi-place pool').to.equal(0);
    expect(r2.held.map((h) => h.reason)).to.deep.equal(held.map(() => 'next_place_unsupported'));
    expect(r2.held.map((h) => h.player).sort()).to.deep.equal([...held].sort());
    expect(monitor.count(METRIC.reveal.releaseHeld, { reason: 'next_place_unsupported' })).to.equal(1);
    expect(steps.filter((x) => x === 'pay_next_place:held-until-cascade')).to.have.length(1);
    expect(w.chain.escrowed).to.deep.equal(escrowBefore, 'every share still in the vault');
    expect(w.chain.platform).to.equal(platformBefore, 'not one lamport to us');
    for (const p of held) expect(w.chain.paid.get(p) ?? 0n).to.equal(0n);

    // Said ONCE per pool: the next ticks neither repeat it nor error.
    const r3 = await daemon.tick();
    expect(r3.errors).to.deep.equal([]);
    expect(r3.held).to.deep.equal([]);
    expect(monitor.count(METRIC.reveal.releaseHeld, { reason: 'next_place_unsupported' })).to.equal(1);
    expect(steps.filter((x) => x === 'pay_next_place:held-until-cascade')).to.have.length(1);
    expect(nextPlaceCalls).to.equal(0);
    // And the program would refuse it anyway.
    await expectRejects(
      () => real(1n, held[0], players.find((p) => !held.includes(p))!, 3, 0n, [], 1, true, []),
      'NextPlaceUnsupported'
    );
    // The type is free again after its cooldown: a held share never
    // freezes the pool type.
    w.clock.t += (await w.chain.getConfig()).cooldownSeconds;
    const r4 = await daemon.tick();
    expect(r4.errors).to.deep.equal([]);
    expect(r4.opened).to.deep.equal([{ poolId: 2n, tier: 0, mode: 0, capacity: 8 }]);
  });

  it('a share forfeited later in the same Ladder pool is reported when it is first seen', async function () {
    this.timeout(60000);
    const w = await makeWorld([[0, 0, 8]]);
    await w.daemon.tick();
    const players = await enterPlayers(w, 1n, 8);
    for (const p of players) await w.chain.flagEntry(1n, p);
    await w.daemon.tick(); // Paid; every paid share escrowed under review
    const held = [...w.chain.escrowed.keys()];
    expect(held.length).to.be.at.least(2);
    // One review upholds first; the other is still open (in the window).
    await w.chain.forfeitEscrow(1n, held[0]);
    const r1 = await w.daemon.tick();
    expect(r1.errors).to.deep.equal([]);
    expect(r1.held.filter((h) => h.reason === 'next_place_unsupported').map((h) => h.player)).to.deep.equal([held[0]]);
    // The second is upheld a tick later: reported then, the first not again.
    await w.chain.forfeitEscrow(1n, held[1]);
    const r2 = await w.daemon.tick();
    expect(r2.held.filter((h) => h.reason === 'next_place_unsupported').map((h) => h.player)).to.deep.equal([held[1]]);
    expect(r2.nextPlacePaid).to.deep.equal([]);
  });

  it('a pool type the program refuses does not starve the types behind it', async () => {
    const w = await makeWorld(LAUNCH_TYPES);
    // A refusal the mirror does not model (the D2 ceiling): the 16-player
    // easy type is refused; the six types behind it in priority still open.
    const real = w.chain.openPool.bind(w.chain);
    w.chain.openPool = async (poolId, tier, pk, hash, mode, capacity) => {
      if (mode === 0 && capacity === 16) throw new Error('VaultCeilingExceeded');
      return real(poolId, tier, pk, hash, mode, capacity);
    };
    const r = await w.daemon.tick();
    expect(r.errors.map((e) => [e.action, e.capacity, e.message.includes('VaultCeilingExceeded')])).to.deep.equal([
      ['keeper', 16, true],
    ]);
    expect(r.opened.map((o) => `${o.mode}:${o.capacity}`)).to.deep.equal([
      '0:8', '0:32', '0:64', '1:8', '1:16', '1:32', '1:64',
    ]);
    expect(r.opened.map((o) => o.poolId)).to.deep.equal([1n, 2n, 3n, 4n, 5n, 6n, 7n], 'ids stay gapless');
  });
});
