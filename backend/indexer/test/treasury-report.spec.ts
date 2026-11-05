/**
 * `GET /treasury` specs (audit B-18, D-18, and prior-audit O26's report
 * half — all 2026-09-12; per pool type since the Ladder, D-E19). Offline:
 * an in-memory `Queryable` that dispatches on statement shape, and an
 * injected chain reader. The properties:
 *
 *   - THE RESERVE IS `idle_pool_type_reserve`, TERM FOR TERM: over every
 *     ENABLED pool type whose tier is open for its mode and whose slot is
 *     empty, `(prize pool + cushion) × reserve_pots`. On the chain path "slot
 *     empty" is the type's own `active_pool` — the field the program reads —
 *     not the indexer's view of it.
 *   - THE FLOOR COUNTS THE RENT CUSHION the program counts. `open_pool`
 *     funds a prize vault with the prize pool PLUS `vault::rent_floor()`, so
 *     a RESERVED prize pool costs `(pot + cushion) * reserve_pots` and the
 *     withdraw floor and every type's shortfall carry it. Drop the term and
 *     the numbers below move by exactly one cushion per reserved prize pool
 *     — which is the assertion.
 *   - THE POLICY IS CHAIN-ANCHORED when the chain read is available, and the
 *     response says so; AN RPC OUTAGE DEGRADES to the ledger and the
 *     `pool_types` projection, never a 500.
 *   - LOCKED CAPITAL, IDLE RESERVE AND MARGIN ARE PER POOL TYPE, and the
 *     realised margin is what paid pools actually returned.
 *   - THE WORK IS BOUNDED. No statement selects the events table without a
 *     slot bound or a LIMIT, and the chain-anchored path reads the ledger
 *     not at all.
 *   - THE SHARED `Config` LAYOUT round-trips, the Ladder's tail included.
 */
import { expect } from 'chai';
import {
  CONFIG_OFFSETS,
  CONFIG_SPACE,
  CONFIG_SPACE_V1,
  CONFIG_SPACE_V2,
  CONFIG_SPACE_V3,
  N_TIERS,
  decodeConfigAccount,
} from '../../_shared/src/config-account';
import {
  LADDER_TABLES,
  MIN_FIELD_BY_CAPACITY,
  TIER_ENTRY_LAMPORTS,
  ladderTable,
  prizePoolFor,
  type PoolCapacity,
} from '../../scoring/src/prizes';
import { handleRead } from '../src/read-api';
import type { Queryable } from '../src/shared';
import { treasuryReport, type PoolTypeTreasury } from '../src/treasury-report';
import type { ChainPoolType, TreasuryChainReader, TreasuryChainView } from '../src/treasury-chain';

const POOL0 = 'F1XTUREPoo1111111111111111111111111111111111';
const POOL2 = 'F1XTUREPoo2222222222222222222222222222222222';

/**
 * The rent-exempt minimum for a zero-data account under the STANDARD rent
 * parameters, which is what `FakeChain.vaultCushionLamports` reports and
 * what the keeper's specs use. Devnet's is 650,240 — the point of reading it
 * from the cluster is that neither number is a constant.
 */
const CUSHION = 890_880n;

/** A pool type's launch prize pool at its tier's launch price. */
const potFor = (tier: number, capacity: PoolCapacity): bigint =>
  prizePoolFor(LADDER_TABLES[capacity], TIER_ENTRY_LAMPORTS[tier]);

interface EventRow {
  slot: string;
  signature: string;
  event_index: number;
  name: string;
  raw: Record<string, unknown>;
}

interface PoolRow {
  pool: string;
  id: string;
  tier: number;
  mode: number;
  capacity: number;
  entry_lamports: string;
  pot_lamports: string;
  state: string;
  entrants: string;
  refunded_count: string;
}

interface PoolTypeRow {
  mode: number;
  tier: number;
  capacity: number;
  pool_type: string | null;
  min_seats: number;
  paid_places: number;
  prize_table: number[];
  pot_lamports: string;
  enabled: boolean;
  next_open_at: string;
  last_pool_id: string | null;
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
  poolTypes: PoolTypeRow[] = [];
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

    if (s.startsWith('SELECT pool, id::text AS id, tier, mode, capacity')) {
      const states = params[0] as string[];
      return { rows: this.pools.filter((p) => states.includes(p.state)) };
    }
    if (s.startsWith('SELECT pool, entry_lamports::text')) {
      const keys = params[0] as string[];
      return { rows: this.pools.filter((p) => keys.includes(p.pool)) };
    }
    if (s.startsWith('SELECT mode, tier, capacity, count(*)::text AS pools')) {
      expect(s).to.contain("WHERE state = 'Paid' GROUP BY mode, tier, capacity");
      const groups = new Map<string, { mode: number; tier: number; capacity: number; pools: number; margin: bigint }>();
      for (const p of this.pools.filter((x) => x.state === 'Paid')) {
        const k = `${p.mode}:${p.tier}:${p.capacity}`;
        const g = groups.get(k) ?? { mode: p.mode, tier: p.tier, capacity: p.capacity, pools: 0, margin: 0n };
        g.pools += 1;
        g.margin += BigInt(p.entry_lamports) * BigInt(p.entrants) - BigInt(p.pot_lamports);
        groups.set(k, g);
      }
      return {
        rows: [...groups.values()].map((g) => ({ ...g, pools: String(g.pools), margin: g.margin.toString() })),
      };
    }
    if (s.startsWith('SELECT mode, tier, capacity, pool_type')) {
      expect(s).to.contain('FROM pool_types');
      return { rows: this.poolTypes };
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
 * open a tier-0 64-player pool (4 SOL prize pool out), sell three passes
 * (0.3 SOL in). */
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

/** The tier-0 64-player pool as the derived table holds it: Open, three entrants. */
function openTier0Pool(): PoolRow {
  return {
    pool: POOL0,
    id: '1',
    tier: 0,
    mode: 0,
    capacity: 64,
    entry_lamports: '100000000',
    pot_lamports: '4000000000',
    state: 'Open',
    entrants: '3',
    refunded_count: '0',
  };
}

/**
 * One pool type at its launch economics (D-E19): the launch table for its
 * size, the launch minimum field, and the prize pool that table pays at the
 * tier's launch price — every number from `backend/scoring/src/prizes.ts`.
 */
function chainType(
  mode: number,
  tier: number,
  capacity: PoolCapacity,
  over: Partial<ChainPoolType> = {}
): ChainPoolType {
  const table = [...ladderTable(capacity)];
  return {
    mode,
    tier,
    capacity,
    minSeats: MIN_FIELD_BY_CAPACITY[capacity],
    paidPlaces: table.length,
    prizeTable: [...table, ...new Array(16 - table.length).fill(0)],
    potLamports: potFor(tier, capacity),
    enabled: true,
    activePool: 0n,
    nextOpenAt: 0n,
    bump: 255,
    address: `PoolType${mode}${tier}${capacity}`,
    activePoolAddress: null,
    ...over,
  };
}

/**
 * The pool types of these specs:
 *   easy tier 0, 8 players   — enabled, idle             → reserves
 *   easy tier 0, 64 players  — enabled, holds pool 1     → reserves nothing
 *   easy tier 1, 64 players  — enabled, idle             → reserves
 *   hard tier 0, 8 players   — enabled, hard tier CLOSED → reserves nothing
 *   easy tier 2, 16 players  — disabled, tier closed     → reserves nothing
 */
function launchTypes(): ChainPoolType[] {
  return [
    chainType(0, 0, 8),
    chainType(0, 0, 64, { activePool: 1n, activePoolAddress: POOL0 }),
    chainType(0, 1, 64),
    chainType(1, 0, 8),
    chainType(0, 2, 16, { enabled: false }),
  ];
}

/** The same pool types as the `pool_types` projection holds them. */
function projectedTypes(): PoolTypeRow[] {
  return launchTypes().map((t) => ({
    mode: t.mode,
    tier: t.tier,
    capacity: t.capacity,
    pool_type: t.address,
    min_seats: t.minSeats,
    paid_places: t.paidPlaces,
    prize_table: t.prizeTable.slice(0, t.paidPlaces),
    pot_lamports: t.potLamports.toString(),
    enabled: t.enabled,
    next_open_at: '0',
    last_pool_id: null,
  }));
}

/**
 * The live Config as devnet holds it (audit O26): a 0.5 SOL minimum the
 * ledger has never seen, and Config's 64-player reference figures six of
 * seven above the launch table. Prices are the launch table.
 */
function liveConfigView(over: Partial<TreasuryChainView> = {}): TreasuryChainView {
  const poolTypes = over.poolTypes ?? launchTypes();
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
    ladderPresent: true,
    enabledPoolTypes: poolTypes.filter((t) => t.enabled).length,
    ...over,
    poolTypes,
  };
}

function readerFor(view: TreasuryChainView): TreasuryChainReader {
  return async () => view;
}

const failingReader: TreasuryChainReader = async () => {
  throw new Error('RPC unreachable');
};

const typeOf = (r: { pool_types: PoolTypeTreasury[] }, mode: 'easy' | 'hard', tier: number, capacity: number) => {
  const t = r.pool_types.find((x) => x.mode === mode && x.tier === tier && x.capacity === capacity);
  if (!t) throw new Error(`no pool type ${mode}/${tier}/${capacity}`);
  return t;
};

describe('the treasury report: the floor the program enforces (D-18, D-E19)', () => {
  const EASY_8 = potFor(0, 8); // 5 entries at 0.1 SOL
  const TIER1_64 = potFor(1, 64); // 40 entries at 0.5 SOL

  it('reserves (prize pool + cushion) for every enabled pool type on an open tier with no live pool', async () => {
    const db = new MemDb();
    db.events = fundedLedger();
    db.pools = [openTier0Pool()];

    const r = await treasuryReport(db, readerFor(liveConfigView()));

    // The launch figures the arithmetic below rests on.
    expect(EASY_8).to.equal(500_000_000n);
    expect(TIER1_64).to.equal(20_000_000_000n);

    // Reserved: easy/0/8 and easy/1/64. Not easy/0/64 (its slot holds pool
    // 1), not hard/0/8 (the hard tier is closed), not easy/2/16 (disabled).
    expect(typeOf(r, 'easy', 0, 8).idle_reserve_lamports).to.equal((EASY_8 + CUSHION).toString());
    expect(typeOf(r, 'easy', 1, 64).idle_reserve_lamports).to.equal((TIER1_64 + CUSHION).toString());
    expect(typeOf(r, 'easy', 0, 64).idle_reserve_lamports).to.equal('0');
    expect(typeOf(r, 'hard', 0, 8).idle_reserve_lamports).to.equal('0');
    expect(typeOf(r, 'easy', 2, 16).idle_reserve_lamports).to.equal('0');
    const idle = EASY_8 + TIER1_64 + 2n * CUSHION;
    expect(r.idle_reserve_lamports).to.equal(idle.toString());

    //   floor = 0.5 SOL minimum + idle reserve + 0.3 SOL refundable
    expect(r.vault_cushion_lamports).to.equal(CUSHION.toString());
    expect(r.withdraw_floor_lamports).to.equal((500_000_000n + idle + 300_000_000n).toString());
    expect(r.withdrawable_lamports).to.equal('0');

    // available = 6.3 − 0.3 = 6.0 SOL. Opening easy/0/8 needs its own prize
    // pool and cushion, the minimum, and the OTHER idle type's reserve:
    //   0.5 SOL + c + 0.5 SOL + (20 SOL + c)
    const needed8 = EASY_8 + CUSHION + 500_000_000n + (TIER1_64 + CUSHION);
    expect(typeOf(r, 'easy', 0, 8)).to.include({
      status: 'short',
      short_by_lamports: (needed8 - 6_000_000_000n).toString(),
    });
    const needed64 = TIER1_64 + CUSHION + 500_000_000n + (EASY_8 + CUSHION);
    expect(typeOf(r, 'easy', 1, 64)).to.include({
      status: 'short',
      short_by_lamports: (needed64 - 6_000_000_000n).toString(),
    });
    expect(typeOf(r, 'easy', 0, 64)).to.include({ status: 'open', live_pool_state: 'Open', live_pool_id: '1' });
    expect(typeOf(r, 'hard', 0, 8)).to.include({ status: 'disabled', tier_open: false, type_enabled: true });
    expect(typeOf(r, 'easy', 2, 16)).to.include({ status: 'disabled', type_enabled: false });

    // The assertion that FAILS if the cushion term is dropped: the floor
    // exceeds the cushion-free arithmetic by exactly one cushion per reserved
    // prize pool (two idle enabled types × reserve_pots 1).
    const floorWithoutCushion = 500_000_000n + EASY_8 + TIER1_64 + 300_000_000n;
    expect(BigInt(r.withdraw_floor_lamports) - floorWithoutCushion).to.equal(2n * CUSHION);

    // The back-compatible tier rows describe each tier's 64-player type.
    expect(r.tiers[0]).to.include({ status: 'open', live_pool_state: 'Open' });
    expect(r.tiers[1]).to.include({ status: 'short', short_by_lamports: (needed64 - 6_000_000_000n).toString() });
    expect(r.tiers[0].hard.status, 'no hard 64-player type exists').to.equal('disabled');

    // The unlock counts start from the FIRST shortfall — the lowest tier,
    // easy first, smallest size first: easy/0/8 — and a full tier-0
    // 64-player pool returns 6.4 − 4 = 2.4 SOL.
    //
    // AT THE FLOOR IT RETURNS NOTHING. The minimum field is the break-even
    // field at every size (40 × 0.1 = the 4 SOL prize pool), so a pool that
    // seals there leaves the treasury exactly where it found it, and no
    // number of such pools covers a shortfall.
    expect(r.tier0_margin_lamports).to.deep.equal({ minimum_field: '0', full: '2400000000' });
    const short = needed8 - 6_000_000_000n;
    expect(r.tier0_pools_to_next_unlock).to.equal(((short + 2_400_000_000n - 1n) / 2_400_000_000n).toString());
    expect(r.tier0_pools_to_next_unlock_at_minimum_field).to.equal(null);
  });

  it('counts one cushion per RESERVED prize pool when reserve_pots is more than one', async () => {
    const db = new MemDb();
    db.events = fundedLedger();
    db.pools = [openTier0Pool()];

    const r = await treasuryReport(db, readerFor(liveConfigView({ reservePots: 3n })));

    const idle = (EASY_8 + CUSHION) * 3n + (TIER1_64 + CUSHION) * 3n;
    expect(r.idle_reserve_lamports).to.equal(idle.toString());
    expect(r.withdraw_floor_lamports).to.equal((500_000_000n + idle + 300_000_000n).toString());
    expect(r.policy.reserve_pots).to.equal(3);
  });

  it("reads the slot as the program does: the type's own active_pool, not the indexer's pools table", async () => {
    // `idle_pool_type_reserve` reads `PoolType.active_pool`. Two ways the
    // indexer can disagree with it, and in both the chain-anchored reserve
    // follows the chain:
    //   - easy/0/64's account holds pool 1, but the table has no live row
    //     for it (not yet ingested): NOT reserved; shown as a held slot.
    //   - easy/1/64's account slot is empty, but the table shows a live
    //     pool of that size (a pool opened before the Ladder, whose slot
    //     lived on Config): RESERVED — the program counts it.
    const db = new MemDb();
    db.events = fundedLedger();
    db.pools = [{ ...openTier0Pool(), pool: POOL2, id: '7', tier: 1, entry_lamports: '500000000', pot_lamports: '20000000000' }];

    const r = await treasuryReport(db, readerFor(liveConfigView()));

    expect(typeOf(r, 'easy', 0, 64)).to.include({
      idle_reserve_lamports: '0',
      status: 'settling',
      live_pool_state: null,
      live_pool_id: '1',
    });
    expect(typeOf(r, 'easy', 1, 64)).to.include({
      idle_reserve_lamports: (TIER1_64 + CUSHION).toString(),
      status: 'open',
      live_pool_id: '7',
    });
  });

  it('a disabled type, or an enabled one on a closed tier, reserves nothing even when idle', async () => {
    const db = new MemDb();
    db.events = fundedLedger();
    db.pools = [openTier0Pool()];
    const view = liveConfigView({
      poolTypes: [
        chainType(0, 0, 64, { activePool: 1n, activePoolAddress: POOL0 }),
        chainType(0, 3, 32), // enabled, tier 3 closed
        chainType(0, 1, 16, { enabled: false }), // tier 1 open, type disabled
      ],
    });
    const r = await treasuryReport(db, readerFor(view));
    expect(r.idle_reserve_lamports).to.equal('0');
    expect(r.withdraw_floor_lamports).to.equal((500_000_000n + 300_000_000n).toString());
    expect(typeOf(r, 'easy', 3, 32).status).to.equal('disabled');
    expect(typeOf(r, 'easy', 1, 16).status).to.equal('disabled');
  });
});

describe('the treasury report: per pool type — locked capital, idle reserve, margin', () => {
  it('locks the live pool’s prize pool against its own type, and none against the others', async () => {
    const db = new MemDb();
    db.events = fundedLedger();
    db.pools = [openTier0Pool()];
    const r = await treasuryReport(db, readerFor(liveConfigView()));
    expect(typeOf(r, 'easy', 0, 64).locked_lamports).to.equal('4000000000');
    for (const t of r.pool_types.filter((x) => !(x.tier === 0 && x.capacity === 64))) {
      expect(t.locked_lamports, `${t.mode}/${t.tier}/${t.capacity}`).to.equal('0');
    }
    expect(r.reserved_pot_lamports).to.equal('4000000000');
  });

  it('states each type’s margin at its own minimum field and full, at today’s price', async () => {
    const db = new MemDb();
    db.events = fundedLedger();
    db.pools = [openTier0Pool()];
    const r = await treasuryReport(db, readerFor(liveConfigView()));
    // Every launch minimum field is the break-even field: the margin there
    // is exactly zero at every size. Full, it is what the other 37.5% of a
    // full field's entries leave: 8 × 0.1 − 0.5, 64 × 0.1 − 4, 64 × 0.5 − 20.
    expect(typeOf(r, 'easy', 0, 8).margin_lamports).to.deep.equal({ minimum_field: '0', full: '300000000' });
    expect(typeOf(r, 'easy', 0, 64).margin_lamports).to.deep.equal({ minimum_field: '0', full: '2400000000' });
    expect(typeOf(r, 'easy', 1, 64).margin_lamports).to.deep.equal({ minimum_field: '0', full: '12000000000' });
    expect(typeOf(r, 'easy', 0, 8)).to.include({ min_seats: 5, paid_places: 2, prize_pool_lamports: '500000000' });
  });

  it('a type with no economics yet has no margin to state', async () => {
    const db = new MemDb();
    db.events = fundedLedger();
    db.pools = [];
    const fresh = chainType(0, 0, 32, {
      enabled: false,
      minSeats: 0,
      paidPlaces: 0,
      prizeTable: new Array(16).fill(0),
      potLamports: 0n,
    });
    const r = await treasuryReport(db, readerFor(liveConfigView({ poolTypes: [fresh] })));
    expect(typeOf(r, 'easy', 0, 32).margin_lamports).to.equal(null);
  });

  it('realises margin only on pools that PAID: entries sold minus the prize pool', async () => {
    const db = new MemDb();
    db.events = fundedLedger();
    const paid = (id: string, capacity: number, entrants: string, pot: string, state = 'Paid'): PoolRow => ({
      ...openTier0Pool(),
      pool: `Paid${id}`,
      id,
      capacity,
      state,
      entrants,
      pot_lamports: pot,
    });
    db.pools = [
      paid('2', 8, '8', '500000000'), // full: 0.8 − 0.5
      paid('3', 8, '6', '500000000'), // 0.6 − 0.5
      paid('4', 8, '2', '500000000', 'Closed'), // refunded: returned nothing
      paid('5', 64, '52', '4000000000'), // a pre-Ladder pool: 5.2 − 4
    ];
    const r = await treasuryReport(db, readerFor(liveConfigView()));
    expect(typeOf(r, 'easy', 0, 8).realised).to.deep.equal({ pools_paid: '2', margin_lamports: '400000000' });
    expect(typeOf(r, 'easy', 0, 64).realised).to.deep.equal({ pools_paid: '1', margin_lamports: '1200000000' });
    expect(typeOf(r, 'easy', 1, 64).realised).to.deep.equal({ pools_paid: '0', margin_lamports: '0' });
    expect(r.realised_margin_lamports).to.equal('1600000000');
  });

  it('lists every type sorted mode (easy first), tier, capacity', async () => {
    const db = new MemDb();
    db.events = fundedLedger();
    db.pools = [openTier0Pool()];
    const r = await treasuryReport(db, readerFor(liveConfigView()));
    expect(r.pool_types.map((t) => `${t.mode}/${t.tier}/${t.capacity}`)).to.deep.equal([
      'easy/0/8',
      'easy/0/64',
      'easy/1/64',
      'easy/2/16',
      'hard/0/8',
    ]);
  });
});

describe('the treasury report: chain-anchored against ledger-derived (O26)', () => {
  it('anchors the policy on the live accounts, and says which it used', async () => {
    const db = new MemDb();
    db.events = fundedLedger();
    db.pools = [openTier0Pool()];
    db.poolTypes = projectedTypes();

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

    // THE REFERENCE FIGURE. A tier with no 64-player type shows Config's
    // own 64-player figure on chain (51.2 SOL on this account) and the
    // launch figure — 40 entries at the launch price — off the ledger.
    expect(onChain.tiers[3].pot_lamports).to.equal('51200000000');
    expect(fromLedger.tiers[3].pot_lamports).to.equal(prizePoolFor(ladderTable(64), TIER_ENTRY_LAMPORTS[3]).toString());

    // THE POOL TYPES come from the projection when the chain is down, and
    // reserve the same two idle types.
    expect(fromLedger.pool_types.map((t) => `${t.mode}/${t.tier}/${t.capacity}`)).to.deep.equal(
      onChain.pool_types.map((t) => `${t.mode}/${t.tier}/${t.capacity}`)
    );
    expect(typeOf(fromLedger, 'easy', 0, 64).status, 'the pools table holds its slot').to.equal('open');

    // THE CUSHION is knowable only from the cluster, so the ledger-derived
    // floor is a LOWER BOUND and publishes a zero cushion to say so:
    //   0 minimum + 0.5 SOL + 20 SOL idle + 0.3 SOL refundable
    expect(fromLedger.vault_cushion_lamports).to.equal('0');
    expect(fromLedger.withdraw_floor_lamports).to.equal('20800000000');
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
    db.poolTypes = projectedTypes();

    const r = await treasuryReport(db, null);
    expect(r.enablement_source).to.equal('launch_default');
    // Tier 0's enabled types are judged on the treasury; tier 1's type is
    // enabled but its tier is closed in the launch posture.
    expect(['openable', 'short']).to.include(typeOf(r, 'easy', 0, 8).status);
    expect(typeOf(r, 'easy', 1, 64)).to.include({ status: 'disabled', tier_open: false });
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

  it('replays the refund fork inside the window: the prize pool returns, each refund leaves', async () => {
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
    // 6.3 + 4 (the untouched prize pool back) − 0.1 (one refund) = 10.2 SOL.
    // The prize pool comes from the `pools` row for the pools named in the
    // window; the refund amount comes from the event, which carries it.
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
    // Two statements over the derived `pools` table — the live slots and the
    // realised margin — and nothing else: not even the pool-type projection,
    // which the accounts answer for.
    expect(db.log).to.have.length(2);
    for (const s of db.log) expect(s).to.match(/FROM pools /);
  });
});

describe('the treasury report: the live-pool aggregate comes from the pools table', () => {
  it('locks a prize pool for a live pool with no events in the window, even with no type for it', async () => {
    const db = new MemDb();
    // The ledger's window has nothing about tier 2 at all, and no pool type
    // exists for tier 2's 64-player size — the pool is known only to the
    // derived table (a pool opened before the Ladder), which is the point.
    db.events = fundedLedger();
    db.pools = [
      openTier0Pool(),
      {
        pool: POOL2,
        id: '2',
        tier: 2,
        mode: 0,
        capacity: 64,
        entry_lamports: '750000000',
        pot_lamports: '38400000000',
        state: 'Sealed',
        entrants: '52',
        refunded_count: '0',
      },
    ];

    const r = await treasuryReport(db, readerFor(liveConfigView()));

    // Both prize pools locked; a Sealed pool takes no more entries, so
    // nothing of it is refundable — and it still holds its slot, so tier 2
    // is 'settling' rather than 'disabled'. It is no enabled type, so it
    // reserves nothing.
    expect(r.reserved_pot_lamports).to.equal((4_000_000_000n + 38_400_000_000n).toString());
    expect(r.tiers[2].status).to.equal('settling');
    expect(r.tiers[2].live_pool_state).to.equal('Sealed');
    expect(r.tiers[0].status).to.equal('open');
    expect(typeOf(r, 'easy', 2, 64)).to.include({
      type_enabled: false,
      locked_lamports: '38400000000',
      idle_reserve_lamports: '0',
    });
  });

  it('a Refunding pool owes only its unrefunded entries, and its prize pool is no longer locked', async () => {
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
    // Two entries of 0.1 SOL still owed; the prize pool has returned to the
    // treasury, so it locks nothing.
    expect(r.refundable_entry_lamports).to.equal('200000000');
    expect(r.reserved_pot_lamports).to.equal('0');
    expect(r.tiers[0].status).to.equal('settling');
    expect(r.tiers[0].live_pool_state).to.equal('Refunding');
    expect(typeOf(r, 'easy', 0, 64).locked_lamports).to.equal('0');
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
    // Tier 0 has no live pool now, and no type on the ledger: nothing to show.
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
    enabledPoolTypes?: number;
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
    view.setUint16(CONFIG_OFFSETS.enabledPoolTypes, fields.enabledPoolTypes ?? 0, true);
    return data;
  }

  it('round-trips the treasury policy and the pool-type count through the byte offsets', () => {
    const pots = TIER_ENTRY_LAMPORTS.map((p) => prizePoolFor(ladderTable(64), p));
    const decoded = decodeConfigAccount(
      configAccount({
        minPlatform: 500_000_000n,
        reservePots: 2,
        refundable: 300_000_000n,
        prices: [...TIER_ENTRY_LAMPORTS],
        pots,
        openTiers: [true, true, false, false, false, false, false],
        enabledPoolTypes: 8,
      })
    );
    expect(decoded.treasuryMinPlatformLamports).to.equal(500_000_000n);
    expect(decoded.treasuryReservePots).to.equal(2);
    expect(decoded.platformRefundable).to.equal(300_000_000n);
    expect(decoded.tierPotLamports).to.deep.equal(pots);
    expect(decoded.tierPriceLamports).to.deep.equal([...TIER_ENTRY_LAMPORTS]);
    expect(decoded.openTiers).to.deep.equal([true, true, false, false, false, false, false]);
    expect(decoded.ladderPresent).to.equal(true);
    expect(decoded.enabledPoolTypes).to.equal(8);
  });

  it('refuses the pre-migration account by name rather than decoding it', () => {
    expect(() => decodeConfigAccount(new Uint8Array(CONFIG_SPACE_V1))).to.throw(
      /pre-migration layout \(380 bytes\)/
    );
  });

  it('refuses any other size', () => {
    expect(() => decodeConfigAccount(new Uint8Array(CONFIG_SPACE + 8))).to.throw(
      /613 bytes; source says 605/
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
    expect(decoded.ladderPresent).to.equal(false);
  });

  // The Ladder (D-E19): `enabled_pool_types` appended; the account is 603
  // bytes until the Ladder's `migrate_config` runs.
  it('reads a pre-Ladder (603-byte) account with no pool-type count', () => {
    const data = new Uint8Array(CONFIG_SPACE_V3);
    data[CONFIG_OFFSETS.hardOpenTiers] = 1;
    const decoded = decodeConfigAccount(data);
    expect(decoded.hardLadderPresent).to.equal(true);
    expect(decoded.hardOpenTiers[0]).to.equal(true);
    expect(decoded.ladderPresent).to.equal(false);
    expect(decoded.enabledPoolTypes).to.equal(0);
  });

  it('reads the hard ladder and the Ladder tail from a current account at the appended offsets', () => {
    const data = new Uint8Array(CONFIG_SPACE);
    const view = new DataView(data.buffer);
    data[CONFIG_OFFSETS.hardOpenTiers + 1] = 1;
    view.setBigUint64(CONFIG_OFFSETS.hardActivePoolByTier + 8 * 1, 31n, true);
    view.setBigInt64(CONFIG_OFFSETS.hardTierNextOpenAt + 8 * 6, 1_790_000_000n, true);
    view.setUint16(CONFIG_OFFSETS.enabledPoolTypes, 3, true);
    const decoded = decodeConfigAccount(data);
    expect(decoded.hardLadderPresent).to.equal(true);
    expect(decoded.hardOpenTiers).to.deep.equal([false, true, false, false, false, false, false]);
    expect(decoded.hardActivePoolByTier[1]).to.equal(31n);
    expect(decoded.hardTierNextOpenAt[6]).to.equal(1_790_000_000n);
    expect(decoded.enabledPoolTypes).to.equal(3);
    // The easy ladder is untouched by the tails — every easy field reads zero.
    expect(decoded.openTiers).to.deep.equal([false, false, false, false, false, false, false]);
    expect(decoded.activePoolByTier[1]).to.equal(0n);
    // The hard tail ends where the Ladder's begins, and that ends the account.
    expect(CONFIG_OFFSETS.hardTierNextOpenAt + 8 * N_TIERS).to.equal(CONFIG_SPACE_V3);
    expect(CONFIG_OFFSETS.enabledPoolTypes).to.equal(CONFIG_SPACE_V3);
    expect(CONFIG_OFFSETS.enabledPoolTypes + 2).to.equal(CONFIG_SPACE);
  });
});
