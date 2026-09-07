/**
 * Treasury-policy specs (D-A1 revised, master prompt v2 2026-08-27):
 * `nextOpenable` mirrors `open_pool`'s gates EXACTLY, and the parity suite
 * proves it — every verdict is executed against `FakeChain.openPool`
 * (which the LiteSVM suite pins to the program) and must agree. Plus the
 * v2-named keeper case: the daemon does nothing while a tier's prior pool
 * is unpaid.
 */
import { expect } from 'chai';
import { createHash } from 'crypto';
import {
  FakeChain,
  StubVrfCoordinator,
  idleTierReserve,
  makeDaemon,
  nextOpenable,
  type TierPoolStates,
} from '../src';
import { LocalCustody } from '../../sealing/src';
import { TIER_ENTRY_LAMPORTS, TIER_POT_LAMPORTS } from '../../scoring/src';

const sha = (s: string) => new Uint8Array(createHash('sha256').update(s).digest());

async function chainWith(min: bigint, now: () => bigint = () => 1_000n): Promise<FakeChain> {
  const chain = new FakeChain(now);
  await chain.initConfig({
    entrySigner: 'entry',
    settlementSigner: 'settle',
    keeper: 'settle',
    vaultCeilingLamports: TIER_ENTRY_LAMPORTS.map((e) => e * 64n),
    treasuryMinPlatformLamports: min,
  });
  return chain;
}

const NONE: TierPoolStates = ['none', 'none', 'none', 'none', 'none', 'none', 'none'];

describe('nextOpenable (the treasury policy, off-chain)', () => {
  it('an empty treasury opens nothing and reports the shortfall', async () => {
    const chain = await chainWith(0n);
    const v = nextOpenable(await chain.getConfig(), 0n, NONE);
    expect(v.tier).to.equal(null);
    expect(v.shortfallLamports).to.equal(TIER_POT_LAMPORTS[0]);
    expect(v.reason).to.contain('short by');
  });

  it('exactly the pot opens tier 0 (the 4 SOL bootstrap, D-E1)', async () => {
    const chain = await chainWith(0n);
    const v = nextOpenable(await chain.getConfig(), TIER_POT_LAMPORTS[0], NONE);
    expect(v.tier).to.equal(0);
  });

  it('the minimum and the idle-tier reserve both raise the bar', async () => {
    const chain = await chainWith(1_000_000_000n);
    chain.config!.openTiers = [true, true, false, false, false, false, false];
    const cfg = await chain.getConfig();
    // Tier 0 needs pot0 + min + tier 1's idle pot.
    const needed = TIER_POT_LAMPORTS[0] + 1_000_000_000n + TIER_POT_LAMPORTS[1];
    expect(idleTierReserve(cfg, 0)).to.equal(TIER_POT_LAMPORTS[1]);
    expect(nextOpenable(cfg, needed - 1n, NONE).tier).to.equal(null);
    expect(nextOpenable(cfg, needed, NONE).tier).to.equal(0);
  });

  it('refundable entries are unavailable for pot funding', async () => {
    const chain = await chainWith(0n);
    const cfg = await chain.getConfig();
    cfg.platformRefundable = 100_000_000n;
    expect(nextOpenable(cfg, TIER_POT_LAMPORTS[0], NONE).tier).to.equal(null);
    expect(nextOpenable(cfg, TIER_POT_LAMPORTS[0] + 100_000_000n, NONE).tier).to.equal(0);
  });

  it('the lowest openable tier wins (the revenue engine never queue-jumped)', async () => {
    const chain = await chainWith(0n);
    chain.config!.openTiers = [true, true, true, true, true, true, true];
    const cfg = await chain.getConfig();
    // Fund everything: every tier is openable — tier 0 must be the pick.
    const v = nextOpenable(cfg, 2_000_000_000_000n, NONE);
    expect(v.tier).to.equal(0);
  });

  it('a tier with a live pool is sequential-blocked, whatever the balance', async () => {
    const chain = await chainWith(0n);
    const cfg = await chain.getConfig();
    cfg.activePoolByTier[0] = 7n;
    const states: TierPoolStates = ['Sealed', 'none', 'none', 'none', 'none', 'none', 'none'];
    const v = nextOpenable(cfg, 2_000_000_000_000n, states);
    expect(v.tier).to.equal(null);
    expect(v.reason).to.contain('Sealed');
  });
});

describe('nextOpenable ↔ FakeChain parity (the on-chain mirror)', () => {
  // Deterministic scenario sweep: enabled-tier masks × balances × one busy
  // tier. For every scenario the pure verdict and the chain must AGREE:
  // a tier verdict opens cleanly; a none verdict means EVERY enabled idle
  // tier's open throws TreasuryShortfall (the sequential/enabled gates are
  // deterministic and covered above).
  it('every verdict agrees with FakeChain.openPool across the sweep', async function () {
    this.timeout(10000);
    const balances = [
      0n,
      TIER_POT_LAMPORTS[0] - 1n,
      TIER_POT_LAMPORTS[0],
      50_000_000_000n,
      900_000_000_000n,
      2_000_000_000_000n,
    ];
    for (let mask = 1; mask < 128; mask += 9) {
      // Proposal E1 §6.3: the exact-boundary balance per mask (and one
      // lamport under it) join the sweep — the zero-slack cascade must
      // agree with the chain at the boundary too, not only around it.
      const enabledPots = TIER_POT_LAMPORTS.filter((_, t) => (mask >> t) % 2 === 1);
      const boundary = enabledPots.reduce((a, p) => a + p, 0n);
      for (const balance of [...balances, boundary, boundary - 1n]) {
        const chain = await chainWith(0n);
        chain.config!.openTiers = Array.from({ length: 7 }, (_, t) => (mask >> t) % 2 === 1);
        chain.fundPlatform(balance + 1n); // +1n: fundPlatform rejects zero
        chain.platform = balance; // exact balance under test
        const cfg = await chain.getConfig();
        const verdict = nextOpenable(cfg, balance, NONE);
        if (verdict.tier !== null) {
          await chain.openPool(1n, verdict.tier, sha('pk'), sha('h'));
          const after = await chain.getConfig();
          expect(after.activePoolByTier[verdict.tier]).to.equal(1n);
        } else {
          for (let t = 0; t < 7; t++) {
            if (!cfg.openTiers[t]) continue;
            try {
              await chain.openPool(1n, t, sha('pk'), sha('h'));
              expect.fail(`verdict said none but tier ${t} opened at balance ${balance}`);
            } catch (e) {
              expect(String(e)).to.contain('TreasuryShortfall');
            }
          }
        }
      }
    }
  });
});

describe('the zero-slack cascade (proposal E1 §6.3)', () => {
  // §6.1: with reserve_pots = 1 and every enabled tier idle, the open gate
  // collapses to `available >= min_platform + Σ pot(enabled)` — and it
  // cascades EXACTLY: opening tier t debits pot[t] and removes pot[t] from
  // the idle reserve in the same step, so a balance that opens the first
  // tier must open every enabled tier in one open-loop. The failure mode
  // this pins is silent in production — lower tiers open, the top tier
  // quietly misses, and the log reads like an ordinary shortfall — so the
  // boundary is asserted with zero slack for EVERY enabled-tier mask, and
  // with a nonzero policy minimum so the floor term is exercised too (the
  // parity sweep above runs with min = 0).
  it('at exactly min_platform + Σ pot, every enabled tier opens in one open-loop', async function () {
    this.timeout(10000);
    const MIN = 2_000_000_000n;
    for (let mask = 1; mask < 128; mask++) {
      const enabled = Array.from({ length: 7 }, (_, t) => (mask >> t) % 2 === 1);
      const sumPots = TIER_POT_LAMPORTS.reduce((a, p, t) => (enabled[t] ? a + p : a), 0n);
      const chain = await chainWith(MIN);
      chain.config!.openTiers = enabled;
      chain.fundPlatform(1n); // fundPlatform rejects zero
      chain.platform = MIN + sumPots; // the boundary, exactly
      const opened: number[] = [];
      // Mirror the daemon's OPEN phase: a loop bounded by the tier count,
      // re-reading config and balance every pass (daemon.ts guard loop).
      for (let guard = 0; guard < 7; guard++) {
        const cfg = await chain.getConfig();
        const v = nextOpenable(cfg, chain.platform, NONE);
        if (v.tier === null) {
          // The loop must end because every enabled tier is busy — a
          // shortfall here IS the silent cascade failure this test exists
          // to catch.
          expect(v.reason, `mask ${mask}: loop ended short, not busy`).to.contain('live pool');
          break;
        }
        await chain.openPool(cfg.nextPoolId, v.tier, sha('pk'), sha('h'));
        opened.push(v.tier);
      }
      const want: number[] = [];
      enabled.forEach((on, t) => {
        if (on) want.push(t);
      });
      expect(opened, `mask ${mask}: opened tiers`).to.deep.equal(want);

      // One lamport under the boundary opens NOTHING: the first tier's
      // gate already demands the whole sum (§6.1), so there is no partial
      // cascade for a near-miss to hide in — and the reported shortfall
      // is exactly the missing lamport.
      const chain2 = await chainWith(MIN);
      chain2.config!.openTiers = [...enabled];
      chain2.fundPlatform(1n);
      chain2.platform = MIN + sumPots - 1n;
      const v2 = nextOpenable(await chain2.getConfig(), chain2.platform, NONE);
      expect(v2.tier, `mask ${mask}: boundary - 1 must open nothing`).to.equal(null);
      expect(v2.shortfallLamports).to.equal(1n);
    }
  });
});

describe('the keeper under the sequential rule (v2-named case)', () => {
  it('does nothing while a tier’s prior pool is unpaid', async () => {
    const clock = { t: 1_000n };
    const chain = await chainWith(0n, () => clock.t);
    chain.fundPlatform(100_000_000_000n);
    const custody = new LocalCustody(async (id) => {
      const p = await chain.getPool(id);
      return p.state !== 'Open';
    });
    // A crank that never settles: the pool stays Sealed (unpaid).
    const daemon = makeDaemon({
      chain,
      custody,
      vrf: new StubVrfCoordinator(chain, 'stub'),
      crank: async (poolId) => ({ poolId, finalState: 'Sealed', stepsTaken: [] }),
      now: () => clock.t,
    });

    const r1 = await daemon.tick();
    expect(r1.opened).to.deep.equal([{ poolId: 1n, tier: 0 }]);
    chain.entries.set('1', [
      {
        player: 'w1',
        index: 0,
        battlesHash: '00',
        flagged: false,
        refunded: false,
        settled: false,
        forfeited: false,
      },
    ]);
    chain.sealPool(1n); // 64th register's effect: Sealed, slot STILL held

    const r2 = await daemon.tick();
    expect(r2.errors).to.deep.equal([]);
    expect(r2.opened).to.deep.equal([], 'no pool may open while the prior is unpaid');
    expect((await chain.getConfig()).nextPoolId).to.equal(2n);
    expect((await chain.getConfig()).activePoolByTier[0]).to.equal(1n);

    // Payment frees the tier: commit + pay via the chain directly.
    await chain.revealPoolSecret(1n, sha('secret'));
    await chain.commitResults(1n, sha('root'), [
      { entryIndex: 0, amountLamports: TIER_POT_LAMPORTS[0] },
    ]);
    await chain.payPrizes(1n, [0]);
    expect((await chain.getPool(1n)).state).to.equal('Paid');

    // Paid frees the slot; the tier still waits out its cooldown.
    const held = await daemon.tick();
    expect(held.opened).to.deep.equal([]);
    clock.t += (await chain.getConfig()).cooldownSeconds;
    const r3 = await daemon.tick();
    expect(r3.opened).to.deep.equal([{ poolId: 2n, tier: 0 }]);
  });
});
