/**
 * `GET /treasury` specs (audit B-18, D-18, and prior-audit O26's report
 * half — all 2026-09-12). Offline: an in-memory `Queryable` that dispatches
 * on statement shape, and an injected chain reader. The properties:
 *
 *   - THE FLOOR COUNTS THE RENT CUSHION the program counts. `open_pool`
 *     funds a prize vault with pot PLUS `vault::rent_floor()`, so a RESERVED
 *     pot costs `(pot + cushion) * reserve_pots` and the withdraw floor and
 *     every tier's shortfall carry it. Drop the term and the numbers below
 *     move by exactly one cushion per reserved pot — which is the assertion.
 *   - THE POLICY IS CHAIN-ANCHORED when the chain read is available, and the
 *     response says so. `init_config` writes the minimum and both tier
 *     tables and emits NO event, so the same ledger yields a 0 minimum and
 *     the launch pots while the live Config holds the founder's real ones.
 *   - AN RPC OUTAGE DEGRADES, never 500s: the same data through a failing
 *     reader comes back ledger-derived and labelled.
 *   - THE WORK IS BOUNDED. No statement selects the events table without a
 *     slot bound or a LIMIT, and the chain-anchored path reads the ledger
 *     not at all.
 *   - THE LIVE-POOL AGGREGATE comes from the derived `pools` table: a pool
 *     with no events in the window at all still reserves its pot and holds
 *     its tier's slot.
 *   - THE SHARED `Config` LAYOUT round-trips. Nothing pinned it before; the
 *     offsets are what both this service and the keeper read the treasury
 *     policy through.
 */
import { expect } from 'chai';
import {
  CONFIG_OFFSETS,
  CONFIG_SPACE,
  CONFIG_SPACE_V1,
  CONFIG_SPACE_V2,
  N_TIERS,
  decodeConfigAccount,
} from '../../_shared/src/config-account';
import { TIER_ENTRY_LAMPORTS, TIER_POT_LAMPORTS } from '../../scoring/src/prizes';
import { handleRead } from '../src/read-api';
import type { Queryable } from '../src/shared';
import { treasuryReport } from '../src/treasury-report';
import type { TreasuryChainReader, TreasuryChainView } from '../src/treasury-chain';

const POOL0 = 'F1XTUREPoo1111111111111111111111111111111111';
const POOL2 = 'F1XTUREPoo2222222222222222222222222222222222';

/**
 * The rent-exempt minimum for a zero-data account under the STANDARD rent
 * parameters, which is what `FakeChain.vaultCushionLamports` reports and
 * what the keeper's specs use. Devnet's is 650,240 — the point of reading it
 * from the cluster is that neither number is a constant.
 */
const CUSHION = 890_880n;

interface EventRow {
  slot: string;
  signature: string;
  event_index: number;
  name: string;
  raw: Record<string, unknown>;
}

interface PoolRow {
  pool: string;
  tier: number;
  entry_lamports: string;
  pot_lamports: string;
  state: string;
  entrants: string;
  refunded_count: string;
}

/**
 * Just enough SQL understanding for treasury-report.ts — dispatch on
 * statement shape, state in arrays, and THROW on anything it does not
 * recognise. The throw is the point: a statement this double has never seen
 * is a statement no reviewer has bounded.
 */
class MemDb implements Queryable {
  events: EventRow[] = [];
  pools: PoolRow[] = [];
  /** Every statement this double has seen, whitespace-normalised. */
  log: string[] = [];

  async query(sql: string, params: readonly unknown[] = []): ReturnType<Queryable['query']> {
    return (await this.run(sql, params)) as never;
  }

  /** Ledger order: slot, then signature, then event_index. */
  private ordered(): EventRow[] {
    return [...this.events].sort(
      (a, b) =>
        Number(BigInt(a.slot) - BigInt(b.slot)) ||
        a.signature.localeCompare(b.signature) ||
        a.event_index - b.event_index
    );
  }

  private async run(sql: string, params: readonly unknown[]): Promise<{ rows: any[] }> {
    const s = sql.replace(/\s+/g, ' ').trim();
    this.log.push(s);

    if (s.startsWith('SELECT tier, entry_lamports::text')) {
      const states = params[0] as string[];
      return { rows: this.pools.filter((p) => states.includes(p.state)) };
    }
    if (s.startsWith('SELECT pool, entry_lamports::text')) {
      const keys = params[0] as string[];
      return { rows: this.pools.filter((p) => keys.includes(p.pool)) };
    }
    if (s.startsWith("SELECT DISTINCT ON (raw->>'tier') raw FROM events WHERE name = 'TierEconomicsSet'")) {
      const latest = new Map<string, EventRow>();
      for (const e of this.ordered()) {
        if (e.name === 'TierEconomicsSet') latest.set(String(e.raw.tier), e);
      }
      return { rows: [...latest.values()].map((e) => ({ raw: e.raw })) };
    }
    if (s.startsWith('SELECT raw FROM events WHERE name = $1 ORDER BY slot DESC')) {
      const matching = this.ordered().filter((e) => e.name === params[0]);
      const last = matching[matching.length - 1];
      return { rows: last ? [{ raw: last.raw }] : [] };
    }
    if (s.startsWith('SELECT slot::text AS slot, signature, event_index, raw FROM events WHERE name = ANY($1)')) {
      const names = params[0] as string[];
      const matching = this.ordered().filter((e) => names.includes(e.name));
      const last = matching[matching.length - 1];
      return { rows: last ? [last] : [] };
    }
    if (s.startsWith('SELECT name, raw FROM events WHERE (slot, signature, event_index) >=')) {
      const [slot, signature, index, names] = params as [string, string, number, string[]];
      const atOrAfter = (e: EventRow): boolean => {
        if (BigInt(e.slot) !== BigInt(slot)) return BigInt(e.slot) > BigInt(slot);
        if (e.signature !== signature) return e.signature > signature;
        return e.event_index >= index;
      };
      return {
        rows: this.ordered()
          .filter((e) => names.includes(e.name) && atOrAfter(e))
          .map((e) => ({ name: e.name, raw: e.raw })),
      };
    }
    throw new Error(`MemDb: unhandled SQL: ${s}`);
  }
}

/** A ledger whose treasury history is: fund 10 SOL, enable tiers 0 and 1,
 * open a tier-0 pool (4 SOL pot out), sell three passes (0.3 SOL in). */
function fundedLedger(): EventRow[] {
  return [
    {
      slot: '10',
      signature: 'sigA',
      event_index: 0,
      name: 'PlatformFunded',
      raw: { funder: 'F', amount: '10000000000', platform_balance: '10000000000' },
    },
    {
      slot: '10',
      signature: 'sigB',
      event_index: 0,
      name: 'TiersOpened',
      raw: { open_tiers: [true, true, false, false, false, false, false] },
    },
    {
      slot: '11',
      signature: 'sigC',
      event_index: 0,
      name: 'PoolOpened',
      raw: {
        pool: POOL0,
        id: '1',
        tier: 0,
        entry_lamports: '100000000',
        pot_lamports: '4000000000',
      },
    },
    ...[0, 1, 2].map((i) => ({
      slot: '12',
      signature: `sigE${i}`,
      event_index: 0,
      name: 'EntryRegistered',
      raw: { pool: POOL0, player: `P${i}`, index: i },
    })),
  ];
}

/** The tier-0 pool as the derived table holds it: Open, three entrants. */
function openTier0Pool(): PoolRow {
  return {
    pool: POOL0,
    tier: 0,
    entry_lamports: '100000000',
    pot_lamports: '4000000000',
    state: 'Open',
    entrants: '3',
    refunded_count: '0',
  };
}

/**
 * The live Config as devnet holds it (audit O26): a 0.5 SOL minimum the
 * ledger has never seen, and tier pots six values out of seven above the
 * launch table. Prices are the launch table, so the tier-0 margin is the
 * same on both paths and only the policy differs.
 */
function liveConfigView(over: Partial<TreasuryChainView> = {}): TreasuryChainView {
  return {
    minPlatformLamports: 500_000_000n,
    reservePots: 1n,
    tierPriceLamports: [...TIER_ENTRY_LAMPORTS],
    tierPotLamports: [
      4_000_000_000n,
      25_600_000_000n,
      38_400_000_000n,
      51_200_000_000n,
      128_000_000_000n,
      256_000_000_000n,
      384_000_000_000n,
    ],
    openTiers: [true, true, false, false, false, false, false],
        hardOpenTiers: [false, false, false, false, false, false, false],
    platformRefundableLamports: 300_000_000n,
    platformBalanceLamports: 6_300_000_000n,
    vaultCushionLamports: CUSHION,
    ...over,
  };
}

function readerFor(view: TreasuryChainView): TreasuryChainReader {
  return async () => view;
}

const failingReader: TreasuryChainReader = async () => {
  throw new Error('RPC unreachable');
};

describe('the treasury report: the floor the program enforces (D-18)', () => {
  it('counts the rent cushion in the floor and in every tier shortfall', async () => {
    const db = new MemDb();
    db.events = fundedLedger();
    db.pools = [openTier0Pool()];

    const r = await treasuryReport(db, readerFor(liveConfigView()));

    // Tier 0 holds a live pool, so only tier 1 is an ENABLED IDLE tier:
    //   idle reserve = (25.6 SOL + cushion) x 1 reserve pot
    //   floor        = 0.5 SOL + idle reserve + 0.3 SOL refundable
    expect(r.vault_cushion_lamports).to.equal(CUSHION.toString());
    expect(r.withdraw_floor_lamports).to.equal('26400890880');
    expect(r.withdrawable_lamports).to.equal('0');

    // available = 6.3 − 0.3 = 6.0 SOL; tier 1 needs its own pot AND its own
    // cushion on top, plus the minimum (no other enabled idle tier):
    //   needed = 25.6 SOL + cushion + 0.5 SOL = 26,100,890,880
    const tier1 = r.tiers[1];
    expect(tier1.status).to.equal('short');
    expect(tier1.short_by_lamports).to.equal('20100890880');

    // The assertion that FAILS if the cushion term is dropped: the floor and
    // the shortfall each exceed the cushion-free arithmetic by exactly one
    // cushion per reserved pot (one enabled idle tier x reserve_pots 1).
    const floorWithoutCushion = 500_000_000n + 25_600_000_000n + 300_000_000n;
    const shortWithoutCushion = 25_600_000_000n + 500_000_000n - 6_000_000_000n;
    expect(BigInt(r.withdraw_floor_lamports) - floorWithoutCushion).to.equal(CUSHION);
    expect(BigInt(tier1.short_by_lamports) - shortWithoutCushion).to.equal(CUSHION);

    // And the unlock counts are computed from the cushion-carrying shortfall:
    // a full tier-0 pool returns 6.4 − 4 = 2.4 SOL.
    //
    // AT THE FLOOR IT RETURNS NOTHING. R7-b put the minimum field on the
    // break-even point (40 × 0.1 = the 4 SOL pot), so a pool that seals
    // there leaves the treasury exactly where it found it. This read
    // `minimum_field: '1200000000'` and `…at_minimum_field: '17'` under
    // D-E4's 52-seat floor.
    //
    // The consequence is worth stating rather than leaving as a null: pools
    // running at the floor never accumulate towards opening the next tier,
    // however many of them run. Only seats above 40 do that.
    expect(r.tier0_margin_lamports).to.deep.equal({
      minimum_field: '0',
      full: '2400000000',
    });
    expect(r.tier0_pools_to_next_unlock).to.equal('9');
    expect(
      r.tier0_pools_to_next_unlock_at_minimum_field,
      'no number of break-even pools covers a shortfall'
    ).to.equal(null);
  });

  it('counts one cushion per RESERVED pot when reserve_pots is more than one', async () => {
    const db = new MemDb();
    db.events = fundedLedger();
    db.pools = [openTier0Pool()];

    const r = await treasuryReport(db, readerFor(liveConfigView({ reservePots: 3n })));

    // (25.6 SOL + cushion) x 3 + 0.5 SOL + 0.3 SOL refundable.
    const idle = (25_600_000_000n + CUSHION) * 3n;
    expect(r.withdraw_floor_lamports).to.equal((500_000_000n + idle + 300_000_000n).toString());
    expect(r.policy.reserve_pots).to.equal(3);
  });
});

describe('the treasury report: chain-anchored against ledger-derived (O26)', () => {
  it('anchors the policy on the live Config, and says which it used', async () => {
    const db = new MemDb();
    db.events = fundedLedger();
    db.pools = [openTier0Pool()];

    const onChain = await treasuryReport(db, readerFor(liveConfigView()));
    const fromLedger = await treasuryReport(db, failingReader);

    // Same data, same live pool, two different sources — each labelled.
    expect(onChain.policy_source).to.equal('chain');
    expect(onChain.enablement_source).to.equal('chain');
    expect(fromLedger.policy_source).to.equal('ledger');
    expect(fromLedger.enablement_source).to.equal('ledger');

    // THE MINIMUM. `init_config` emits no event, so the ledger has none and
    // the report used to publish a 0 floor term against a program enforcing
    // a real one.
    expect(onChain.policy.min_platform_lamports).to.equal('500000000');
    expect(fromLedger.policy.min_platform_lamports).to.equal('0');

    // THE TIER TABLE. Same story: the live pot is 25.6 SOL, the launch
    // constant is 20 SOL.
    expect(onChain.tiers[1].pot_lamports).to.equal('25600000000');
    expect(fromLedger.tiers[1].pot_lamports).to.equal(TIER_POT_LAMPORTS[1].toString());

    // THE CUSHION is knowable only from the cluster, so the ledger-derived
    // floor is a LOWER BOUND and publishes a zero cushion to say so.
    expect(fromLedger.vault_cushion_lamports).to.equal('0');
    expect(fromLedger.withdraw_floor_lamports).to.equal('20300000000');
    expect(
      BigInt(onChain.withdraw_floor_lamports) > BigInt(fromLedger.withdraw_floor_lamports),
      'the chain-anchored floor is the higher of the two'
    ).to.equal(true);

    // The balance agrees either way: the chain reads the platform PDA, the
    // ledger replays 10 − 4 + 0.3 from its latest anchor.
    expect(onChain.platform_balance_lamports).to.equal('6300000000');
    expect(fromLedger.platform_balance_lamports).to.equal('6300000000');
    expect(fromLedger.refundable_entry_lamports).to.equal('300000000');
  });

  it('with no chain reader at all it serves the ledger-derived report', async () => {
    const db = new MemDb();
    db.events = fundedLedger();
    db.pools = [openTier0Pool()];

    const r = await treasuryReport(db, null);
    expect(r.policy_source).to.equal('ledger');
    expect(r.platform_balance_lamports).to.equal('6300000000');
  });

  it('a ledger with no TiersOpened falls back to the launch posture: tier 0 only', async () => {
    const db = new MemDb();
    db.events = fundedLedger().filter((e) => e.name !== 'TiersOpened');
    db.pools = [];

    const r = await treasuryReport(db, null);
    expect(r.enablement_source).to.equal('launch_default');
    expect(r.tiers[0].status).to.equal('openable');
    for (let t = 1; t < N_TIERS; t++) expect(r.tiers[t].status, `tier ${t}`).to.equal('disabled');
  });

  it('a TreasuryPolicySet on the ledger moves the minimum without a chain read', async () => {
    const db = new MemDb();
    db.events = [
      ...fundedLedger(),
      {
        slot: '13',
        signature: 'sigP',
        event_index: 0,
        name: 'TreasuryPolicySet',
        raw: { reserve_pots: 2, min_platform_lamports: '750000000' },
      },
    ];
    db.pools = [openTier0Pool()];

    const r = await treasuryReport(db, null);
    expect(r.policy).to.deep.equal({ reserve_pots: 2, min_platform_lamports: '750000000' });
  });

  it('routes through GET /treasury with the reader the caller passes', async () => {
    const db = new MemDb();
    db.events = fundedLedger();
    db.pools = [openTier0Pool()];

    const res = await handleRead(db, '/treasury', () => 0, readerFor(liveConfigView()));
    expect(res.status).to.equal(200);
    expect((res.body as Record<string, unknown>).policy_source).to.equal('chain');

    // A reader that throws must not reach the route as a 500: this endpoint
    // is public and rate-limited, not authenticated.
    const degraded = await handleRead(db, '/treasury', () => 0, failingReader);
    expect(degraded.status).to.equal(200);
    expect((degraded.body as Record<string, unknown>).policy_source).to.equal('ledger');
  });
});

describe('the treasury report: bounded work (B-18)', () => {
  /** Every statement that touches the ledger must carry a bound. */
  function assertLedgerReadsAreBounded(log: readonly string[]): void {
    for (const s of log) {
      if (!/FROM events/.test(s)) continue;
      expect(s, `unbounded ledger read: ${s}`).to.match(/WHERE|LIMIT/);
      expect(s, `ledger read with neither a slot bound nor a LIMIT: ${s}`).to.match(
        /LIMIT 1|slot|DISTINCT ON/
      );
    }
  }

  it('never selects the whole events table, and bounds the balance by the latest anchor', async () => {
    const db = new MemDb();
    db.events = fundedLedger();
    db.pools = [openTier0Pool()];

    await treasuryReport(db, null);

    // The statement this finding is about, exactly as it was.
    expect(db.log).to.not.include('SELECT name, raw FROM events ORDER BY slot, signature, event_index');
    assertLedgerReadsAreBounded(db.log);

    // The fold's window starts AT the latest anchor — slot 10, `sigA` — not
    // at the start of the ledger.
    const fold = db.log.find((s) => s.startsWith('SELECT name, raw FROM events'));
    expect(fold, 'the bounded fold statement').to.be.a('string');
    expect(fold).to.match(/\(slot, signature, event_index\) >=/);
  });

  it('applies only the events at or after the anchor, so an earlier history cannot move the balance', async () => {
    const db = new MemDb();
    // A long history BEFORE the anchor: opens, entries and refunds that all
    // predate the last withdrawal. None of them may affect the answer.
    db.events = [
      ...[...Array(40).keys()].map((i) => ({
        slot: String(i + 1),
        signature: `sigOld${String(i).padStart(3, '0')}`,
        event_index: 0,
        name: 'EntryRegistered',
        raw: { pool: POOL0, player: `Old${i}`, index: i },
      })),
      {
        slot: '100',
        signature: 'sigAnchor',
        event_index: 0,
        name: 'PlatformWithdrawn',
        raw: { destination: 'D', amount: '1000000000', platform_balance: '5000000000' },
      },
      {
        slot: '101',
        signature: 'sigLate',
        event_index: 0,
        name: 'EntryRegistered',
        raw: { pool: POOL0, player: 'Late', index: 63 },
      },
    ];
    db.pools = [openTier0Pool()];

    const r = await treasuryReport(db, null);
    // 5 SOL at the anchor, plus ONE 0.1 SOL entry after it.
    expect(r.platform_balance_lamports).to.equal('5100000000');
  });

  it('replays the refund fork inside the window: the pot returns, each refund leaves', async () => {
    const db = new MemDb();
    db.events = [
      ...fundedLedger(),
      {
        slot: '13',
        signature: 'sigR',
        event_index: 0,
        name: 'RefundTriggered',
        raw: { pool: POOL0, entrants: 3 },
      },
      {
        slot: '14',
        signature: 'sigX',
        event_index: 0,
        name: 'Refunded',
        raw: { pool: POOL0, player: 'P0', amount: '100000000' },
      },
    ];
    db.pools = [{ ...openTier0Pool(), state: 'Refunding', refunded_count: '1' }];

    const r = await treasuryReport(db, null);
    // 6.3 + 4 (the untouched pot back) − 0.1 (one refund) = 10.2 SOL. The
    // pot comes from the `pools` row for the pools named in the window;
    // the refund amount comes from the event, which carries it.
    expect(r.platform_balance_lamports).to.equal('10200000000');
    expect(r.reserved_pot_lamports).to.equal('0');
    expect(r.refundable_entry_lamports).to.equal('200000000');
  });

  it('reads the ledger not at all when the policy is chain-anchored', async () => {
    const db = new MemDb();
    db.events = fundedLedger();
    db.pools = [openTier0Pool()];

    await treasuryReport(db, readerFor(liveConfigView()));

    expect(db.log.filter((s) => /FROM events/.test(s))).to.deep.equal([]);
    expect(db.log).to.have.length(1);
    expect(db.log[0]).to.match(/FROM pools/);
  });
});

describe('the treasury report: the live-pool aggregate comes from the pools table', () => {
  it('reserves a pot and holds a tier slot for a pool with no events in the window', async () => {
    const db = new MemDb();
    // The ledger's window has nothing about tier 2 at all — the pool is
    // known only to the derived table, which is the point.
    db.events = fundedLedger();
    db.pools = [
      openTier0Pool(),
      {
        pool: POOL2,
        tier: 2,
        entry_lamports: '750000000',
        pot_lamports: '38400000000',
        state: 'Sealed',
        entrants: '52',
        refunded_count: '0',
      },
    ];

    const r = await treasuryReport(db, readerFor(liveConfigView()));

    // Both pots reserved; a Sealed pool takes no more entries, so nothing of
    // it is refundable — and it still holds its tier's slot, so tier 2 is
    // 'settling' rather than 'disabled'.
    expect(r.reserved_pot_lamports).to.equal((4_000_000_000n + 38_400_000_000n).toString());
    expect(r.tiers[2].status).to.equal('settling');
    expect(r.tiers[2].live_pool_state).to.equal('Sealed');
    expect(r.tiers[0].status).to.equal('open');
  });

  it('a Refunding pool owes only its unrefunded entries, and its pot is no longer reserved', async () => {
    const db = new MemDb();
    db.events = fundedLedger();
    db.pools = [
      {
        ...openTier0Pool(),
        state: 'Refunding',
        entrants: '3',
        refunded_count: '1',
      },
    ];

    const r = await treasuryReport(db, null);
    // Two entries of 0.1 SOL still owed; the pot has returned to the
    // treasury, so it reserves nothing.
    expect(r.refundable_entry_lamports).to.equal('200000000');
    expect(r.reserved_pot_lamports).to.equal('0');
    expect(r.tiers[0].status).to.equal('settling');
    expect(r.tiers[0].live_pool_state).to.equal('Refunding');
  });

  it('a Paid or Closed pool contributes nothing — the query never asks for one', async () => {
    const db = new MemDb();
    db.events = fundedLedger();
    db.pools = [
      { ...openTier0Pool(), state: 'Paid' },
      { ...openTier0Pool(), pool: POOL2, tier: 1, state: 'Closed' },
    ];

    const r = await treasuryReport(db, null);
    expect(r.reserved_pot_lamports).to.equal('0');
    expect(r.refundable_entry_lamports).to.equal('0');
    // Tier 0 has no live pool now, so it is judged on the treasury instead.
    expect(r.tiers[0].live_pool_state).to.equal(null);
  });
});

describe('the shared Config layout', () => {
  /** Build a Config account with the fields this report reads. */
  function configAccount(fields: {
    minPlatform: bigint;
    reservePots: number;
    refundable: bigint;
    prices: bigint[];
    pots: bigint[];
    openTiers: boolean[];
  }): Uint8Array {
    const data = new Uint8Array(CONFIG_SPACE);
    const view = new DataView(data.buffer);
    view.setBigUint64(CONFIG_OFFSETS.minPlatform, fields.minPlatform, true);
    data[CONFIG_OFFSETS.reservePots] = fields.reservePots;
    view.setBigUint64(CONFIG_OFFSETS.platformRefundable, fields.refundable, true);
    for (let t = 0; t < N_TIERS; t++) {
      view.setBigUint64(CONFIG_OFFSETS.tierPrice + 8 * t, fields.prices[t], true);
      view.setBigUint64(CONFIG_OFFSETS.tierPot + 8 * t, fields.pots[t], true);
      data[CONFIG_OFFSETS.openTiers + t] = fields.openTiers[t] ? 1 : 0;
    }
    return data;
  }

  it('round-trips the treasury policy through the byte offsets', () => {
    const pots = [...TIER_POT_LAMPORTS];
    const decoded = decodeConfigAccount(
      configAccount({
        minPlatform: 500_000_000n,
        reservePots: 2,
        refundable: 300_000_000n,
        prices: [...TIER_ENTRY_LAMPORTS],
        pots,
        openTiers: [true, true, false, false, false, false, false],
      })
    );
    expect(decoded.treasuryMinPlatformLamports).to.equal(500_000_000n);
    expect(decoded.treasuryReservePots).to.equal(2);
    expect(decoded.platformRefundable).to.equal(300_000_000n);
    expect(decoded.tierPotLamports).to.deep.equal(pots);
    expect(decoded.tierPriceLamports).to.deep.equal([...TIER_ENTRY_LAMPORTS]);
    expect(decoded.openTiers).to.deep.equal([true, true, false, false, false, false, false]);
  });

  it('refuses the pre-migration account by name rather than decoding it', () => {
    expect(() => decodeConfigAccount(new Uint8Array(CONFIG_SPACE_V1))).to.throw(
      /pre-migration layout \(380 bytes\)/
    );
  });

  it('refuses any other size', () => {
    expect(() => decodeConfigAccount(new Uint8Array(CONFIG_SPACE + 8))).to.throw(
      /611 bytes; source says 603/
    );
  });

  // Phase B (2026-09-24): the hard ladder was appended, and the live account
  // is the old size until `migrate_config` runs in the upgrade window.
  it('reads a pre-Phase-B (484-byte) account with the hard ladder absent', () => {
    const data = new Uint8Array(CONFIG_SPACE_V2);
    data[CONFIG_OFFSETS.openTiers] = 1;
    const decoded = decodeConfigAccount(data);
    expect(decoded.openTiers[0]).to.equal(true);
    expect(decoded.hardLadderPresent).to.equal(false);
    expect(decoded.hardOpenTiers).to.deep.equal([false, false, false, false, false, false, false]);
    expect(decoded.hardActivePoolByTier).to.deep.equal([0n, 0n, 0n, 0n, 0n, 0n, 0n]);
    expect(decoded.hardTierNextOpenAt).to.deep.equal([0n, 0n, 0n, 0n, 0n, 0n, 0n]);
  });

  it('reads the hard ladder from a current account at the appended offsets', () => {
    const data = new Uint8Array(CONFIG_SPACE);
    const view = new DataView(data.buffer);
    data[CONFIG_OFFSETS.hardOpenTiers + 1] = 1;
    view.setBigUint64(CONFIG_OFFSETS.hardActivePoolByTier + 8 * 1, 31n, true);
    view.setBigInt64(CONFIG_OFFSETS.hardTierNextOpenAt + 8 * 6, 1_790_000_000n, true);
    const decoded = decodeConfigAccount(data);
    expect(decoded.hardLadderPresent).to.equal(true);
    expect(decoded.hardOpenTiers).to.deep.equal([false, true, false, false, false, false, false]);
    expect(decoded.hardActivePoolByTier[1]).to.equal(31n);
    expect(decoded.hardTierNextOpenAt[6]).to.equal(1_790_000_000n);
    // The easy ladder is untouched by the tail — every easy field reads zero.
    expect(decoded.openTiers).to.deep.equal([false, false, false, false, false, false, false]);
    expect(decoded.activePoolByTier[1]).to.equal(0n);
    // And the tail ends exactly at the account's end.
    expect(CONFIG_OFFSETS.hardTierNextOpenAt + 8 * N_TIERS).to.equal(CONFIG_SPACE);
  });
});
