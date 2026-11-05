/**
 * Treasury-policy specs (D-A1 revised, master prompt v2 2026-08-27; per
 * POOL TYPE since the Ladder, D-E19): `nextOpenable` mirrors `open_pool`'s
 * gates EXACTLY, and the parity suite proves it — every verdict is executed
 * against `FakeChain.openPool` (which mirrors the program, LiteSVM-pinned)
 * and must agree. Plus the v2-named keeper case: the daemon does nothing
 * while a pool type's prior pool is unpaid.
 */
import { expect } from 'chai';
import { createHash } from 'crypto';
import {
  FakeChain,
  StubVrfCoordinator,
  idlePoolTypeReserve,
  makeDaemon,
  nextOpenable,
  poolTypeKey,
  type ChainPoolTypeView,
  type PoolStateName,
} from '../src';
import { LocalCustody, MemoryCiphertextStore } from '../../sealing/src';
import {
  TIER_ENTRY_LAMPORTS,
  ladderTable,
  minFieldFor,
  prizePoolFor,
} from '../../scoring/src';
import { LAUNCH_CAPACITIES, ladderChain, rawTable } from './ladder-fixtures';

const sha = (s: string) => new Uint8Array(createHash('sha256').update(s).digest());

/**
 * The per-pool rent cushion the program applies (`vault::rent_floor()` —
 * the rent-exempt minimum for a zero-data account). `FakeChain` reports the
 * standard-parameter figure; every expectation below carries it explicitly,
 * because the whole point of the 2026-09-12 fix is that a mirror which
 * forgets it understates what the program demands.
 */
const CUSHION = 890_880n;

/** A pool type's prize pool at tier `tier`'s launch price. */
const potOf = (capacity: number, tier = 0) => prizePoolFor(ladderTable(capacity), TIER_ENTRY_LAMPORTS[tier]);

/** The launch posture (D-E19): both modes × the four sizes, at tier 0. */
const LAUNCH_TYPES: ReadonlyArray<readonly [number, number, number]> = [0, 1].flatMap((mode) =>
  LAUNCH_CAPACITIES.map((cap) => [mode, 0, cap] as const)
);

/** A chain at the launch posture: the eight types enabled, both tier-0 switches on. */
async function launchChain(min = 0n, now: () => bigint = () => 1_000n): Promise<FakeChain> {
  const chain = await ladderChain(now, LAUNCH_TYPES, min);
  chain.setHardOpenTiers([true, false, false, false, false, false, false]);
  return chain;
}

const states = (): ReadonlyMap<bigint, PoolStateName> => new Map();

async function expectRejects(fn: () => Promise<unknown> | unknown, message: string): Promise<void> {
  let caught = '';
  try {
    await fn();
  } catch (e) {
    caught = String(e);
  }
  expect(caught, `expected ${message}`).to.include(message);
}

describe('nextOpenable (the treasury policy, off-chain, per pool type)', () => {
  it('an empty treasury opens nothing and reports the shortfall', async () => {
    const chain = await ladderChain();
    const v = nextOpenable(await chain.getConfig(), await chain.getPoolTypes(), 0n, undefined, CUSHION);
    expect(v.tier).to.equal(null);
    expect(v.capacity).to.equal(null);
    expect(v.shortfallLamports).to.equal(potOf(64) + CUSHION);
    expect(v.reason).to.contain('short by');
  });

  it('the prize pool alone is a lamport short: the vault needs its rent cushion too', async () => {
    // `open_pool` funds prize pool PLUS the cushion, so the bootstrap figure
    // is both and a treasury holding exactly the prize pool is refused — by
    // the program, and by this mirror.
    const chain = await ladderChain();
    const cfg = await chain.getConfig();
    const types = await chain.getPoolTypes();
    expect(nextOpenable(cfg, types, potOf(64), undefined, CUSHION).tier).to.equal(null);
    const v = nextOpenable(cfg, types, potOf(64) + CUSHION, undefined, CUSHION);
    expect([v.mode, v.tier, v.capacity]).to.deep.equal([0, 0, 64]);
  });

  it('the minimum and the idle reserve of every OTHER enabled type both raise the bar', async () => {
    const chain = await ladderChain(() => 0n, [
      [0, 0, 8],
      [0, 0, 64],
    ], 1_000_000_000n);
    const cfg = await chain.getConfig();
    const types = await chain.getPoolTypes();
    // The 8-player type opens first and needs its own prize pool + cushion,
    // the minimum, and the 64-player type's idle prize pool — which carries a
    // cushion of its own because opening it would fund one.
    const needed = potOf(8) + CUSHION + 1_000_000_000n + (potOf(64) + CUSHION);
    expect(idlePoolTypeReserve(cfg, types, { mode: 0, tier: 0, capacity: 8 }, CUSHION)).to.equal(
      potOf(64) + CUSHION
    );
    expect(idlePoolTypeReserve(cfg, types, null, CUSHION)).to.equal(
      potOf(8) + CUSHION + potOf(64) + CUSHION
    );
    expect(nextOpenable(cfg, types, needed - 1n, undefined, CUSHION).tier).to.equal(null);
    expect(nextOpenable(cfg, types, needed, undefined, CUSHION).capacity).to.equal(8);
  });

  it('refundable entries are unavailable for prize funding', async () => {
    const chain = await ladderChain();
    const cfg = await chain.getConfig();
    const types = await chain.getPoolTypes();
    cfg.platformRefundable = 100_000_000n;
    expect(nextOpenable(cfg, types, potOf(64) + CUSHION, undefined, CUSHION).tier).to.equal(null);
    expect(nextOpenable(cfg, types, potOf(64) + CUSHION + 100_000_000n, undefined, CUSHION).tier).to.equal(0);
  });

  it('priority: the lowest tier, then easy before hard, then the smallest pool', async () => {
    const chain = await launchChain();
    chain.setOpenTiers([true, true, false, false, false, false, false]);
    chain.addPoolType(0, 1, 8);
    const cfg = await chain.getConfig();
    const types = await chain.getPoolTypes();
    // Fund everything: every type is openable — the order is the policy's.
    const order: string[] = [];
    const live = types.map((t) => ({ ...t }));
    for (let i = 0; i < live.length; i++) {
      const v = nextOpenable(cfg, live, 10n ** 15n, undefined, CUSHION);
      if (v.tier === null) break;
      order.push(poolTypeKey({ mode: v.mode!, tier: v.tier, capacity: v.capacity! }));
      live.find((t) => poolTypeKey(t) === order[order.length - 1])!.activePool = BigInt(i + 1);
    }
    expect(order).to.deep.equal([
      '0:0:8', '0:0:16', '0:0:32', '0:0:64',
      '1:0:8', '1:0:16', '1:0:32', '1:0:64',
      '0:1:8',
    ]);
  });

  it('a type with a live pool is sequential-blocked whatever the balance, named by its pool`s state', async () => {
    const chain = await ladderChain();
    const types = await chain.getPoolTypes();
    types[0].activePool = 7n;
    const v = nextOpenable(await chain.getConfig(), types, 10n ** 15n, undefined, CUSHION, {
      poolStates: new Map([[7n, 'Sealed' as PoolStateName]]),
    });
    expect(v.tier).to.equal(null);
    expect(v.reason).to.contain('easy tier 0 cap 64: Sealed');
  });

  it('a type refused earlier this tick is not offered again, and does not block the next', async () => {
    const chain = await ladderChain(() => 0n, [
      [0, 0, 8],
      [0, 0, 16],
    ]);
    const cfg = await chain.getConfig();
    const types = await chain.getPoolTypes();
    const v = nextOpenable(cfg, types, 10n ** 15n, undefined, CUSHION, {
      skip: new Set(['0:0:8']),
    });
    expect(v.capacity).to.equal(16);
    const none = nextOpenable(cfg, types, 10n ** 15n, undefined, CUSHION, {
      skip: new Set(['0:0:8', '0:0:16']),
    });
    expect(none.tier).to.equal(null);
    expect(none.reason).to.contain('refused earlier this tick');
  });

  it('nothing enabled on an open tier is the launch posture, said as such', async () => {
    const chain = await ladderChain(() => 0n, []);
    const v = nextOpenable(await chain.getConfig(), await chain.getPoolTypes(), 10n ** 15n, undefined, CUSHION);
    expect(v.reason).to.equal('no pool type is enabled on an open tier');
  });
});

describe('the two switches and current economics (D-E19): mirror and fake agree', () => {
  it('a disabled type never opens and reserves nothing; enabling it restores both', async () => {
    const chain = await ladderChain(() => 0n, [
      [0, 0, 8],
      [0, 0, 64],
    ]);
    chain.fundPlatform(10n ** 13n);
    chain.setPoolTypeEnabled(0, 0, 64, false);
    expect((await chain.getConfig()).enabledPoolTypes).to.equal(1);
    const cfg = await chain.getConfig();
    const types = await chain.getPoolTypes();
    expect(idlePoolTypeReserve(cfg, types, null, CUSHION)).to.equal(potOf(8) + CUSHION);
    await expectRejects(() => chain.openPool(1n, 0, sha('pk'), sha('h'), 0, 64), 'PoolTypeDisabled');
    const v = nextOpenable(cfg, types, chain.platform, undefined, CUSHION);
    expect(v.capacity).to.equal(8);
    // The switch is a no-op on repeat: the count moves on a change only.
    chain.setPoolTypeEnabled(0, 0, 64, false);
    expect((await chain.getConfig()).enabledPoolTypes).to.equal(1);
    chain.setPoolTypeEnabled(0, 0, 64, true);
    expect((await chain.getConfig()).enabledPoolTypes).to.equal(2);
  });

  it('a type on a tier closed for its mode never opens and reserves nothing (R6 still governs)', async () => {
    const chain = await ladderChain(() => 0n, [
      [0, 0, 8],
      [1, 0, 8],
    ]);
    chain.fundPlatform(10n ** 13n);
    // Hard tier 0 is closed at init: the hard type is enabled but idle-and-off.
    const cfg = await chain.getConfig();
    const types = await chain.getPoolTypes();
    expect(cfg.hardOpenTiers[0]).to.equal(false);
    expect(idlePoolTypeReserve(cfg, types, null, CUSHION)).to.equal(potOf(8) + CUSHION);
    await expectRejects(() => chain.openPool(1n, 0, sha('pk'), sha('h'), 1, 8), 'TierNotOpen');
    chain.setHardOpenTiers([true, false, false, false, false, false, false]);
    const cfg2 = await chain.getConfig();
    expect(idlePoolTypeReserve(cfg2, types, null, CUSHION)).to.equal(2n * (potOf(8) + CUSHION));
  });

  it('a price change makes the type stale: the mirror skips it and the fake refuses it until restated', async () => {
    const chain = await ladderChain();
    chain.fundPlatform(10n ** 13n);
    const newPrice = TIER_ENTRY_LAMPORTS[1];
    chain.setTierEconomics(0, newPrice, potOf(64, 1));
    const v = nextOpenable(await chain.getConfig(), await chain.getPoolTypes(), chain.platform, undefined, CUSHION);
    expect(v.tier).to.equal(null);
    expect(v.reason).to.contain('economics stale');
    await expectRejects(() => chain.openPool(1n, 0, sha('pk'), sha('h'), 0, 64), 'PoolTypeEconomicsStale');
    // Restated at the new price: the published prize moved because the
    // founder moved it, never silently with the price.
    const table = rawTable(ladderTable(64));
    chain.setPoolTypeEconomics(0, 0, 64, minFieldFor(64), table, prizePoolFor(ladderTable(64), newPrice));
    const v2 = nextOpenable(await chain.getConfig(), await chain.getPoolTypes(), chain.platform, undefined, CUSHION);
    expect(v2.capacity).to.equal(64);
    await chain.openPool(1n, 0, sha('pk'), sha('h'), 0, 64);
    const pool = await chain.getPool(1n);
    expect(pool.entryLamports).to.equal(newPrice);
    expect(pool.potLamports).to.equal(prizePoolFor(ladderTable(64), newPrice));
  });

  it('the pool type admin instructions refuse what the program refuses', async () => {
    const chain = await ladderChain(() => 0n, []);
    for (const cap of [0, 4, 12, 24, 48, 65, 128]) {
      expect(() => chain.initPoolType(0, 0, cap), `${cap}`).to.throw('UnknownCapacity');
    }
    expect(() => chain.initPoolType(2, 0, 8)).to.throw('UnknownMode');
    expect(() => chain.initPoolType(0, 7, 8)).to.throw('UnknownTier');
    chain.initPoolType(0, 0, 16);
    expect(() => chain.initPoolType(0, 0, 16)).to.throw('already in use');
    // Enabling needs economics.
    expect(() => chain.setPoolTypeEnabled(0, 0, 16, true)).to.throw('PoolTypeEconomicsUnset');
    const price = TIER_ENTRY_LAMPORTS[0];
    const ok = rawTable(ladderTable(16)); // [5,3,1,1]
    const pot = prizePoolFor(ladderTable(16), price);
    const bad = (t: number[]) => () => chain.setPoolTypeEconomics(0, 0, 16, 10, t, pot);
    const inc = [...ok];
    inc[1] = 6;
    expect(bad(inc)).to.throw('PrizeTableMalformed'); // increasing
    const hole = [...ok];
    hole[2] = 0;
    expect(bad(hole)).to.throw('PrizeTableMalformed'); // a zero inside the paid places
    const extra = [...ok];
    extra[4] = 1;
    expect(bad(extra)).to.throw('PrizeTableMalformed'); // pays a fifth place of 16
    expect(() => chain.setPoolTypeEconomics(0, 0, 16, 4, ok, pot)).to.throw('MinimumFieldInvalid');
    expect(() => chain.setPoolTypeEconomics(0, 0, 16, 17, ok, pot)).to.throw('MinimumFieldInvalid');
    expect(() => chain.setPoolTypeEconomics(0, 0, 16, 10, ok, pot + 1n)).to.throw('PrizePoolMismatch');
    expect(() => chain.setPoolTypeEconomics(0, 0, 16, 9, ok, pot)).to.throw('PotExceedsMinimumField');
    chain.setPoolTypeEconomics(0, 0, 16, 10, ok, pot);
    chain.setPoolTypeEnabled(0, 0, 16, true);
    expect((await chain.getConfig()).enabledPoolTypes).to.equal(1);
  });
});

describe('nextOpenable ↔ FakeChain parity (the on-chain mirror)', () => {
  // Deterministic scenario sweep: enabled-type masks over the eight launch
  // types × balances. For every scenario the pure verdict and the chain
  // must AGREE: a verdict opens cleanly; a none verdict means EVERY enabled
  // idle type's open throws TreasuryShortfall.
  it('every verdict agrees with FakeChain.openPool across the sweep', async function () {
    this.timeout(20000);
    const balances = [0n, potOf(8) - 1n, potOf(8), 5_000_000_000n, 20_000_000_000n, 10n ** 13n];
    for (let mask = 1; mask < 256; mask += 7) {
      const enabled = LAUNCH_TYPES.filter((_, i) => (mask >> i) % 2 === 1);
      // Proposal E1 §6.3: the exact-boundary balance per mask (and one
      // lamport under it) join the sweep.
      const boundary = enabled.reduce((a, [, tier, cap]) => a + potOf(cap, tier) + CUSHION, 0n);
      for (const balance of [...balances, boundary, boundary - 1n]) {
        const chain = await launchChain();
        for (const [mode, tier, cap] of LAUNCH_TYPES) {
          if (!enabled.some(([m, t, c]) => m === mode && t === tier && c === cap)) {
            chain.setPoolTypeEnabled(mode, tier, cap, false);
          }
        }
        chain.fundPlatform(balance + 1n); // +1n: fundPlatform rejects zero
        chain.platform = balance; // exact balance under test
        const cfg = await chain.getConfig();
        const types = await chain.getPoolTypes();
        const verdict = nextOpenable(cfg, types, balance, undefined, CUSHION);
        if (verdict.tier !== null) {
          await chain.openPool(1n, verdict.tier, sha('pk'), sha('h'), verdict.mode!, verdict.capacity!);
          const t = (await chain.getPoolTypes()).find(
            (x) => poolTypeKey(x) === poolTypeKey({ mode: verdict.mode!, tier: verdict.tier!, capacity: verdict.capacity! })
          )!;
          expect(t.activePool).to.equal(1n);
        } else {
          for (const [mode, tier, cap] of enabled) {
            await expectRejects(
              () => chain.openPool(1n, tier, sha('pk'), sha('h'), mode, cap),
              'TreasuryShortfall'
            );
          }
        }
      }
    }
  });
});

describe('the zero-slack cascade (proposal E1 §6.3), over pool types', () => {
  // §6.1: with reserve_pots = 1 and every enabled type idle, the open gate
  // collapses to `available >= min_platform + Σ (prize pool + cushion)` over
  // the enabled types — and it cascades EXACTLY: opening a type debits its
  // prize pool and cushion and removes the same from the idle reserve in the
  // same step, so a balance that opens the first type opens every enabled
  // type in one open-loop. Asserted with zero slack for EVERY mask of the
  // eight launch types, with a nonzero policy minimum.
  it('at exactly min_platform + Σ (prize pool + cushion), every enabled type opens in one loop', async function () {
    this.timeout(30000);
    const MIN = 2_000_000_000n;
    for (let mask = 1; mask < 256; mask++) {
      const on = LAUNCH_TYPES.map((_, i) => (mask >> i) % 2 === 1);
      const sum = LAUNCH_TYPES.reduce((a, [, tier, cap], i) => (on[i] ? a + potOf(cap, tier) + CUSHION : a), 0n);
      const chain = await launchChain(MIN);
      LAUNCH_TYPES.forEach(([mode, tier, cap], i) => {
        if (!on[i]) chain.setPoolTypeEnabled(mode, tier, cap, false);
      });
      chain.fundPlatform(1n);
      chain.platform = MIN + sum; // the boundary, exactly
      const opened: string[] = [];
      for (let guard = 0; guard < LAUNCH_TYPES.length; guard++) {
        const cfg = await chain.getConfig();
        const v = nextOpenable(cfg, await chain.getPoolTypes(), chain.platform, undefined, CUSHION);
        if (v.tier === null) {
          // The loop must end because every enabled type is busy — a
          // shortfall here IS the silent cascade failure this test exists
          // to catch.
          expect(v.reason, `mask ${mask}: loop ended short, not busy`).to.contain('live pool');
          break;
        }
        await chain.openPool(cfg.nextPoolId, v.tier, sha('pk'), sha('h'), v.mode!, v.capacity!);
        opened.push(poolTypeKey({ mode: v.mode!, tier: v.tier, capacity: v.capacity! }));
      }
      const want = LAUNCH_TYPES.filter((_, i) => on[i]).map(([mode, tier, capacity]) =>
        poolTypeKey({ mode, tier, capacity })
      );
      expect(opened, `mask ${mask}: opened types`).to.deep.equal(want);
      // Every lamport is accounted for: nothing left but the minimum.
      expect(chain.platform, `mask ${mask}`).to.equal(MIN);

      // One lamport under the boundary opens NOTHING, and the reported
      // shortfall is exactly the missing lamport.
      const chain2 = await launchChain(MIN);
      LAUNCH_TYPES.forEach(([mode, tier, cap], i) => {
        if (!on[i]) chain2.setPoolTypeEnabled(mode, tier, cap, false);
      });
      chain2.fundPlatform(1n);
      chain2.platform = MIN + sum - 1n;
      const v2 = nextOpenable(await chain2.getConfig(), await chain2.getPoolTypes(), chain2.platform, undefined, CUSHION);
      expect(v2.tier, `mask ${mask}: boundary - 1 must open nothing`).to.equal(null);
      expect(v2.shortfallLamports).to.equal(1n);
    }
  });
});

describe('the keeper under the sequential rule (v2-named case)', () => {
  it('does nothing while a pool type`s prior pool is unpaid', async () => {
    const clock = { t: 1_000n };
    const chain = await ladderChain(() => clock.t);
    chain.fundPlatform(100_000_000_000n);
    const custody = new LocalCustody(async (id) => {
      const p = await chain.getPool(id);
      return p.state !== 'Open';
    });
    // A crank that never settles: the pool stays Sealed (unpaid).
    const daemon = makeDaemon({
      chain,
      custody,
      ciphertexts: new MemoryCiphertextStore(),
      vrf: new StubVrfCoordinator(chain, 'stub'),
      crank: async (poolId) => ({ poolId, finalState: 'Sealed', stepsTaken: [] }),
      now: () => clock.t,
    });

    const r1 = await daemon.tick();
    expect(r1.opened).to.deep.equal([{ poolId: 1n, tier: 0, mode: 0, capacity: 64 }]);
    // Sixteen entrants: exactly the table's sixteen paid places.
    const table = ladderTable(64);
    chain.entries.set(
      '1',
      table.map((_, i) => ({
        player: `w${i}`,
        index: i,
        battlesHash: '00',
        flagged: false,
        refunded: false,
        settled: false,
        forfeited: false,
      }))
    );
    chain.sealPool(1n); // the deadline seal's effect: Sealed, slot STILL held

    const r2 = await daemon.tick();
    expect(r2.errors).to.deep.equal([]);
    expect(r2.opened).to.deep.equal([], 'no pool may open while the prior is unpaid');
    expect((await chain.getConfig()).nextPoolId).to.equal(2n);
    expect((await chain.getPoolTypes())[0].activePool).to.equal(1n);

    // Payment frees the type: commit + pay via the chain directly, each
    // place its table amount (untied), summing to the prize pool.
    const entry = (await chain.getPool(1n)).entryLamports;
    await chain.revealPoolSecret(1n, sha('secret'));
    await chain.commitResults(
      1n,
      sha('root'),
      table.map((m, i) => ({ entryIndex: i, amountLamports: BigInt(m) * entry }))
    );
    await chain.payPrizes(1n, table.map((_, i) => i));
    expect((await chain.getPool(1n)).state).to.equal('Paid');

    // Paid frees the slot; the type still waits out its cooldown.
    const held = await daemon.tick();
    expect(held.opened).to.deep.equal([]);
    clock.t += (await chain.getConfig()).cooldownSeconds;
    const r3 = await daemon.tick();
    expect(r3.opened).to.deep.equal([{ poolId: 2n, tier: 0, mode: 0, capacity: 64 }]);
  });
});

describe('the hard ladder beside the easy one, per pool type (Phase B + D-E19)', () => {
  it('an unknown mode or capacity has no pool type to open', async () => {
    const chain = await launchChain();
    chain.fundPlatform(10n ** 13n);
    await expectRejects(() => chain.openPool(1n, 0, sha('pk'), sha('h'), 2, 8), 'AccountNotInitialized');
    await expectRejects(() => chain.openPool(1n, 0, sha('pk'), sha('h'), 0, 12), 'AccountNotInitialized');
    await expectRejects(() => chain.openPool(1n, 1, sha('pk'), sha('h'), 0, 8), 'AccountNotInitialized');
  });

  it('the hard type`s slot frees on its own clock, leaving the easy pool alone', async () => {
    const clock = { t: 1_000n };
    const chain = await ladderChain(() => clock.t, [
      [0, 0, 8],
      [1, 0, 8],
    ]);
    chain.setHardOpenTiers([true, false, false, false, false, false, false]);
    chain.fundPlatform(100_000_000_000n);
    await chain.openPool(1n, 0, sha('pk'), sha('h'), 0, 8);
    await chain.openPool(2n, 0, sha('pk'), sha('h'), 1, 8);
    expect((await chain.getPool(2n)).mode).to.equal(1);
    // The hard pool (2) refunds empty past its deadline: Closed, its type's
    // slot freed and stamped; the easy pool (1) and its type untouched.
    clock.t = 1_000n + 12n * 3600n + 1n;
    await chain.triggerRefund(2n);
    const cfg = await chain.getConfig();
    const [easy, hard] = await chain.getPoolTypes();
    expect((await chain.getPool(2n)).state).to.equal('Closed');
    expect(hard.activePool).to.equal(0n);
    expect(hard.nextOpenAt).to.equal(clock.t + cfg.cooldownSeconds);
    expect(easy.activePool).to.equal(1n);
    expect(easy.nextOpenAt).to.equal(0n);
    // Inside the hard cooldown: the slot is free but the clock holds it.
    const v = nextOpenable(cfg, await chain.getPoolTypes(), chain.platform, clock.t, CUSHION, {
      poolStates: states(),
    });
    expect(v.tier).to.equal(null);
    expect(v.reason).to.contain('hard tier 0 cap 8: cooling down');
    clock.t += cfg.cooldownSeconds;
    const v2 = nextOpenable(await chain.getConfig(), await chain.getPoolTypes(), chain.platform, clock.t, CUSHION);
    expect([v2.mode, v2.tier, v2.capacity]).to.deep.equal([1, 0, 8]);
  });

  it('every pool copies its type`s capacity, floor and table at open', async () => {
    const chain = await launchChain();
    chain.fundPlatform(10n ** 13n);
    let id = 1n;
    for (const [mode, tier, cap] of LAUNCH_TYPES) {
      await chain.openPool(id, tier, sha('pk'), sha('h'), mode, cap);
      const p = await chain.getPool(id);
      expect([p.mode, p.capacity, p.minSeats, p.paidPlaces]).to.deep.equal([
        mode,
        cap,
        minFieldFor(cap),
        ladderTable(cap).length,
      ]);
      expect(p.prizeTable).to.deep.equal(rawTable(ladderTable(cap)));
      expect(p.potLamports).to.equal(potOf(cap, tier));
      id++;
    }
    // A later change to the type never reaches the pool it already opened.
    chain.setPoolTypeEnabled(0, 0, 8, false);
    expect((await chain.getPool(1n)).capacity).to.equal(8);
    const t8 = (await chain.getPoolTypes()).find((t: ChainPoolTypeView) => poolTypeKey(t) === '0:0:8')!;
    expect(t8.activePool).to.equal(1n, 'disabling a type never touches its live pool');
  });
});
