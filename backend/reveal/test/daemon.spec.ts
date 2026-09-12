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
  battlesHash,
  potForTier,
  REVIEW_WINDOW_SECS,
  TIER_ENTRY_LAMPORTS,
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
    keeper: 'settle',
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
    ciphertexts: store,
    vrf: new StubVrfCoordinator(chain, base58Encode(sha('randomness'))),
    crank: (poolId) =>
      crankPool({ chain, custody, ciphertexts: store, publisher }, poolId),
    now: () => clock.t,
  });
  return { chain, custody, store, publisher, daemon, clock };
}

/** Prompt v2 §B.6: a settled tier reopens on the first tick AFTER its
 * cooldown (five minutes at launch) — never in the settling tick itself.
 * Advances the clock by exactly the cooldown and ticks. */
async function tickAfterCooldown(w: World) {
  w.clock.t += (await w.chain.getConfig()).cooldownSeconds;
  return w.daemon.tick();
}

/** Enter `n` players into an Open pool with real sealed ciphertexts, then
 * apply the program's post-entry transition (the seal at 64) exactly as
 * `register` would. */
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
      settled: false,
      forfeited: false,
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
    expect(cfg.activePoolByTier[0]).to.equal(0n);
    expect(cfg.tierNextOpenAt[0]).to.equal(w.clock.t + cfg.cooldownSeconds);
    const r2 = await tickAfterCooldown(w);
    expect(r2.opened).to.deep.equal([{ poolId: 2n, tier: 0 }]);

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
    expect(r.opened).to.deep.equal([]); // Closed stamps the cooldown too
    for (const p of players) {
      expect(w.chain.paid.get(p)).to.equal(TIER_ENTRY_LAMPORTS[0]); // 100% back (R7)
    }
    expect((await tickAfterCooldown(w)).opened).to.deep.equal([{ poolId: 2n, tier: 0 }]);
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
    expect((await tickAfterCooldown(w)).opened).to.deep.equal([{ poolId: 2n, tier: 0 }]);
  });

  it('the cooldown holds the keeper to the second, then the tier reopens', async () => {
    const w = await makeWorld();
    await w.daemon.tick();
    w.clock.t = (await w.chain.getPool(1n)).fillDeadline + 1n;
    await w.daemon.tick(); // the empty pool closes; the cooldown starts
    const cfg = await w.chain.getConfig();
    expect(cfg.cooldownSeconds).to.equal(300n, 'DEFAULT_COOLDOWN_SECS');
    const nextOpenAt = cfg.tierNextOpenAt[0];
    expect(nextOpenAt).to.equal(w.clock.t + 300n);
    w.clock.t = nextOpenAt - 1n;
    const held = await w.daemon.tick();
    expect(held.opened).to.deep.equal([]);
    expect(held.errors).to.deep.equal([], 'a hold is a verdict, not a failed transaction');
    w.clock.t = nextOpenAt;
    expect((await w.daemon.tick()).opened).to.deep.equal([{ poolId: 2n, tier: 0 }]);
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
    expect((await w.daemon.tick()).opened).to.deep.equal([{ poolId: 1n, tier: 0 }]);
    // And the cooldown still governs the keeper, exactly as before.
    w.clock.t = (await w.chain.getPool(1n)).fillDeadline + 1n;
    await w.daemon.tick(); // closes pool 1; the cooldown is stamped
    const nextOpenAt = (await w.chain.getConfig()).tierNextOpenAt[0];
    w.clock.t = nextOpenAt - 1n;
    expect((await w.daemon.tick()).opened).to.deep.equal([], 'one second early');
    w.clock.t = nextOpenAt;
    expect((await w.daemon.tick()).opened).to.deep.equal([{ poolId: 2n, tier: 0 }]);
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
    w.chain.config!.openTiers = [true, true, false, false, false, false, false];
    const r = await w.daemon.tick();
    expect(r.opened).to.deep.equal([{ poolId: 2n, tier: 1 }]);
    expect((await w.chain.getPool(2n)).fillDeadline).to.equal(w.clock.t + 3600n);
    await expectRejects(async () => w.chain.setPoolTiming(0n, 60n), 'InvalidTiming');
  });

  it('a 52-seat pool past its deadline seals, cranks to Paid and the tier reopens after the cooldown', async function () {
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
    expect((await tickAfterCooldown(w)).opened).to.deep.equal([{ poolId: 2n, tier: 0 }]);

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
    expect((await tickAfterCooldown(w)).opened).to.deep.equal([{ poolId: 2n, tier: 0 }]);

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
    // (`enterPlayers` pushes entries directly, so a 52nd seat past the
    // deadline is a test convenience `register` itself would refuse.)
    await enterPlayers(w, 1n, 1);
    await expectRejects(() => w.chain.triggerRefund(1n), 'FieldReached');
    await w.chain.sealAtDeadline(1n);
    expect((await w.chain.getPool(1n)).state).to.equal('Sealed');
  });
});

describe('the daemon (C8): escrow under the 2026-09-07 ruling (FakeChain mirror)', () => {
  it('a forfeit moves nothing; the share passes to the eligible tied player, never the treasury', async function () {
    this.timeout(30000);
    const w = await makeWorld();
    await w.daemon.tick(); // opens pool 1
    const players = await enterPlayers(w, 1n, 64); // seals
    const pot = potForTier(0);
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
    expect(heldTotal).to.equal(potForTier(0), 'the whole pot is under review');
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
    expect(paid).to.equal(potForTier(0));
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

    // Review upholds every held share: forfeited, waiting for
    // pay_next_place — the clock must leave each exactly where it is.
    for (const p of held) await w.chain.forfeitEscrow(1n, p);

    w.clock.t = settledAt + REVIEW_WINDOW_SECS + 24n * 3600n;
    const r = await w.daemon.tick();
    expect(r.errors).to.deep.equal([]);
    expect(r.released).to.deep.equal([], 'a forfeited share is never auto-released');
    for (const p of held) expect(w.chain.escrowed.get(p)).to.not.equal(undefined, 'still held');
    // And a forfeited hold does not pin the pool as non-terminal: the
    // sweep treats it as decided (its route is pay_next_place, audit O23).
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

  it('the next-place driver: an upheld flag on the winner pays the share to the next rank (O23)', async function () {
    this.timeout(120000);
    // Pass 1: settle a pool naturally to learn who the scoring engine ranks
    // first. The field is deterministic (players are seeded by pool id and
    // index), so pass 2 reproduces it exactly.
    const probe = await makeWorld();
    await probe.daemon.tick();
    await enterPlayers(probe, 1n, 64);
    await probe.daemon.tick();
    const winnerSeat = (await probe.chain.getPool(1n)).payouts[0].entryIndex;

    // Pass 2: the same field, but the winner is flagged BEFORE settlement —
    // the only order the program allows (`flag_entry` refuses a settled
    // entry), and therefore the only way a prize is ever escrowed.
    const w = await makeWorld();
    await w.daemon.tick();
    const players = await enterPlayers(w, 1n, 64);
    await w.chain.flagEntry(1n, players[winnerSeat]);
    const pot = potForTier(0);

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
      pot,
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

  it('the sweep does not go terminal on a pool whose share is still held or forfeited (O23)', async function () {
    this.timeout(120000);
    // The floor advances over a terminal PREFIX. A pool that settles with a
    // held share must therefore not read as terminal, or the sweep would
    // walk past it and never come back to carry the share onward.
    const probe = await makeWorld();
    await probe.daemon.tick();
    await enterPlayers(probe, 1n, 64);
    await probe.daemon.tick();
    const winnerSeat = (await probe.chain.getPool(1n)).payouts[0].entryIndex;

    const w = await makeWorld();
    await w.daemon.tick();
    const players = await enterPlayers(w, 1n, 64);
    await w.chain.flagEntry(1n, players[winnerSeat]);
    await w.daemon.tick(); // settles; the prize is escrowed under the flag

    // Held: a second pool opens for the tier, and pool 1 is still swept.
    await w.chain.forfeitEscrow(1n, players[winnerSeat]);
    const before = w.chain.escrowed.get(players[winnerSeat]);
    expect(before).to.equal(potForTier(0));
    const r = await w.daemon.tick();
    expect(r.nextPlacePaid.length).to.be.greaterThan(0, 'the sweep came back to pool 1');
  });

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
    const pot = potForTier(0);
    let paid = 0n;
    for (const v of w.chain.paid.values()) paid += v;
    for (const v of w.chain.escrowed.values()) paid += v;
    expect(paid).to.equal(pot);
    // And, after the cooldown, the tier has exactly one successor — even
    // with both daemons ticking.
    w.clock.t += (await w.chain.getConfig()).cooldownSeconds;
    await Promise.all([w.daemon.tick(), second.tick()]);
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
      ciphertexts: w.store,
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
    const done = daemon.run(5, ac.signal, {
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
      afterIteration: () => order.push('iteration'),
    });
    await new Promise((r) => setTimeout(r, 60));
    ac.abort();
    await done;

    // A clean iteration is before → after → iteration, in that order.
    expect(order.slice(0, 3)).to.deep.equal(['before', 'after', 'iteration']);
    // The failing one is before → error → iteration: no report, and the
    // liveness hook still runs.
    expect(order.slice(3, 6)).to.deep.equal(['before', 'error', 'iteration']);
    expect(errors.length).to.equal(1);
    expect(String(errors[0])).to.contain('rpc down');
    // The loop kept going after the failure, and every report it handed back
    // is a real tick report.
    expect(iteration).to.be.greaterThan(2);
    expect(reports.length).to.be.greaterThan(1);
    for (const r of reports) expect(r.errors).to.be.an('array');
  });

  it('run() survives a hook that throws — book-keeping never stops the sweep', async () => {
    const w = await makeWorld();
    let iterations = 0;
    const ac = new AbortController();
    const done = w.daemon.run(5, ac.signal, {
      afterTick: () => {
        throw new Error('health write failed');
      },
      afterIteration: () => {
        iterations++;
        throw new Error('alert sink down');
      },
    });
    await new Promise((r) => setTimeout(r, 40));
    ac.abort();
    await done;
    expect(iterations).to.be.greaterThan(2);
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
      keeper: 'settle',
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
    // Pass 1: learn the winning seat (deterministic field).
    const probe = await makeWorld();
    await probe.daemon.tick();
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
    const players = await enterPlayers(w, 1n, 64);
    const winner = players[winnerSeat];
    await w.chain.flagEntry(1n, winner);
    const settledAt = w.clock.t;
    const r1 = await daemon.tick();
    expect(r1.errors).to.deep.equal([]);
    expect(w.chain.escrowed.get(winner)).to.equal(potForTier(0), "the winner's prize is held");
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
    expect(w.chain.escrowed.get(winner)).to.equal(potForTier(0));
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
