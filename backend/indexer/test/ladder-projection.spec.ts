/**
 * The Ladder (D-E19) through the whole ingest path: `Program data:` lines
 * encoded with the program's Borsh layouts (`programs/blotto_cup/src/
 * events.rs`) → the shared decoder → the ledger → the projection
 * (migration 0026). Encoded here rather than taken from a LiteSVM dump
 * because the dump (`tests/litesvm/tests/dump_events.rs`) predates the
 * Ladder; these are byte-for-byte the struct order the program declares.
 *
 * What is pinned: a pool row carries its own size, floor and table (never
 * the zero padding); the three pool-type events build one `pool_types` row
 * per (mode, tier, capacity); a slot stamp is keyed by the pool TYPE; a
 * pre-Ladder event reads as 64 seats and one paid place; and a rebuild from
 * the ledger alone reproduces every row.
 */
import { expect } from 'chai';
import { SILENT_MONITOR } from '../src/shared';
import { base58Decode, base58Encode, registerBlottoEventLayouts } from '../../_shared/src/blotto-events';
import { anchorEventDiscriminator } from '../../_shared/src/events';
import { LADDER_TABLES, TIER_ENTRY_LAMPORTS, prizePoolFor } from '../../scoring/src/prizes';
import { programDataLine } from './event-codec';
import { InMemoryEventStore } from '../src/store';
import { ingestTransaction, type IngestContext } from '../src/ingest';

const CTX: IngestContext = { commitment: 'confirmed', program: 'blotto_cup' };

const addr = (n: number): string => base58Encode(new Uint8Array(32).fill(n));

/** A little Borsh writer: the field types the program's events use. */
class W {
  private parts: Buffer[] = [];
  pubkey(b58: string): this {
    this.parts.push(Buffer.from(base58Decode(b58)));
    return this;
  }
  u8(v: number): this {
    this.parts.push(Buffer.from([v]));
    return this;
  }
  bool(v: boolean): this {
    return this.u8(v ? 1 : 0);
  }
  u16(v: number): this {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(v);
    this.parts.push(b);
    return this;
  }
  u64(v: bigint): this {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(v);
    this.parts.push(b);
    return this;
  }
  i64(v: bigint): this {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(v);
    this.parts.push(b);
    return this;
  }
  bytes(b: Uint8Array): this {
    this.parts.push(Buffer.from(b));
    return this;
  }
  /** `[u8; 16]`, zero-padded — the on-chain prize table. */
  table(t: readonly number[]): this {
    const b = Buffer.alloc(16);
    t.forEach((m, i) => (b[i] = m));
    this.parts.push(b);
    return this;
  }
  line(name: string): string {
    return programDataLine(Buffer.concat([anchorEventDiscriminator(name), ...this.parts]));
  }
}

const POOL = addr(11);
const OLD_POOL = addr(12);
const TYPE_HARD_16 = addr(21);
const TYPE_EASY_8 = addr(22);
const PRICE = TIER_ENTRY_LAMPORTS[0];

/** `PoolOpened` as the Ladder program emits it — the tail included. */
function poolOpened(o: {
  pool: string;
  id: bigint;
  mode: number;
  capacity: number;
  minSeats: number;
  table: readonly number[];
}): string {
  return new W()
    .pubkey(o.pool)
    .u64(o.id)
    .u8(0) // tier
    .u64(PRICE)
    .u64(prizePoolFor(o.table, PRICE))
    .i64(1_800_000_000n) // fill_deadline
    .u8(15) // timer_seconds
    .bytes(new Uint8Array(32).fill(0xaa))
    .bytes(new Uint8Array(32).fill(0xbb))
    .u8(o.mode)
    .u16(o.capacity)
    .u16(o.minSeats)
    .u8(o.table.length)
    .table(o.table)
    .line('PoolOpened');
}

/** `PoolOpened` as a program from before the Ladder emitted it: it ends at `mode`. */
function preLadderPoolOpened(pool: string, id: bigint): string {
  return new W()
    .pubkey(pool)
    .u64(id)
    .u8(0)
    .u64(PRICE)
    .u64(4_000_000_000n)
    .i64(1_700_000_000n)
    .u8(15)
    .bytes(new Uint8Array(32).fill(0xaa))
    .bytes(new Uint8Array(32).fill(0xbb))
    .u8(0)
    .line('PoolOpened');
}

function tierSlotFreed(o: { mode: number; capacity?: number; poolId: bigint; nextOpenAt: bigint }): string {
  const w = new W().u8(0).u64(o.poolId).i64(o.nextOpenAt).u8(o.mode);
  if (o.capacity !== undefined) w.u16(o.capacity);
  return w.line('TierSlotFreed');
}

function typeInitialized(t: string, mode: number, capacity: number): string {
  return new W().pubkey(t).u8(mode).u8(0).u16(capacity).line('PoolTypeInitialized');
}

function typeEconomics(t: string, mode: number, capacity: 8 | 16 | 32 | 64, minSeats: number): string {
  const table = LADDER_TABLES[capacity];
  return new W()
    .pubkey(t)
    .u8(mode)
    .u8(0)
    .u16(capacity)
    .u16(minSeats)
    .u8(table.length)
    .table(table)
    .u64(prizePoolFor(table, PRICE))
    .line('PoolTypeEconomicsSet');
}

function typeEnabled(t: string, mode: number, capacity: number, enabled: boolean, count: number): string {
  return new W().pubkey(t).u8(mode).u8(0).u16(capacity).bool(enabled).u16(count).line('PoolTypeEnabledSet');
}

async function ingest(lines: string[][]): Promise<InMemoryEventStore> {
  const store = new InMemoryEventStore();
  for (let i = 0; i < lines.length; i++) {
    await ingestTransaction(store, SILENT_MONITOR, CTX, {
      signature: `LADDER${String(i).padStart(4, '0')}`,
      slot: BigInt(i + 1),
      logs: lines[i],
    });
  }
  return store;
}

type Row = Record<string, unknown>;
const rows = (store: InMemoryEventStore, table: string): Row[] =>
  Object.values(store.projection.snapshot()[table] ?? {});

describe('the Ladder reaches the derived tables (D-E19, migration 0026)', () => {
  before(() => registerBlottoEventLayouts());

  it('a pool row carries its own size, floor and table — never the zero padding', async () => {
    const store = await ingest([
      [poolOpened({ pool: POOL, id: 30n, mode: 1, capacity: 16, minSeats: 10, table: LADDER_TABLES[16] })],
    ]);
    const [p] = rows(store, 'pools');
    expect(p).to.include({ pool: POOL, mode: 1, capacity: 16, min_seats: 10, paid_places: 4, state: 'Open' });
    expect(p.prize_table).to.deep.equal([5, 3, 1, 1]);
    // The prize pool the event carried is the table at the price, exactly.
    expect(p.pot_lamports).to.equal((10n * PRICE).toString());
  });

  it('a pre-Ladder PoolOpened reads as 64 seats and one place worth the whole prize pool', async () => {
    const store = await ingest([[preLadderPoolOpened(OLD_POOL, 9n)]]);
    const [p] = rows(store, 'pools');
    // 4 SOL at 0.1 SOL is 40 whole entries — `preLadderTable`, the rule the
    // program's own migration writes.
    expect(p).to.include({ capacity: 64, paid_places: 1, mode: 0 });
    expect(p.prize_table).to.deep.equal([40]);
    // The floor is not stated by the event, so it is not guessed.
    expect(p.min_seats).to.equal(null);
  });

  it('PoolMigrated states an old pool’s floor and, from the Ladder on, its size and table', async () => {
    const migrated = new W()
      .pubkey(OLD_POOL)
      .u16(40) // min_seats
      .u8(0) // mode
      .u16(64)
      .u8(1)
      .table([40])
      .line('PoolMigrated');
    const store = await ingest([[preLadderPoolOpened(OLD_POOL, 9n)], [migrated]]);
    const [p] = rows(store, 'pools');
    expect(p).to.include({ capacity: 64, paid_places: 1, min_seats: 40 });
    expect(p.prize_table).to.deep.equal([40]);

    // An earlier migration's event ends at `mode`: it moves the floor only.
    const phaseB = new W().pubkey(OLD_POOL).u16(52).u8(0).line('PoolMigrated');
    const older = await ingest([[preLadderPoolOpened(OLD_POOL, 9n)], [phaseB]]);
    expect(rows(older, 'pools')[0]).to.include({ min_seats: 52, capacity: 64, paid_places: 1 });
  });

  it('the three pool-type events build one row per (mode, tier, capacity)', async () => {
    const store = await ingest([
      [typeInitialized(TYPE_HARD_16, 1, 16)],
      [typeInitialized(TYPE_EASY_8, 0, 8)],
    ]);
    const init = rows(store, 'pool_types');
    expect(init).to.have.length(2);
    const fresh = init.find((r) => r.pool_type === TYPE_HARD_16)!;
    // Exactly what `init_pool_type` writes: disabled, no table, no prize pool.
    expect(fresh).to.deep.include({
      mode: 1,
      tier: 0,
      capacity: 16,
      enabled: false,
      min_seats: 0,
      paid_places: 0,
      prize_table: [],
      pot_lamports: '0',
      next_open_at: '0',
    });

    const later = await ingest([
      [typeInitialized(TYPE_HARD_16, 1, 16)],
      [typeEconomics(TYPE_HARD_16, 1, 16, 10)],
      [typeEnabled(TYPE_HARD_16, 1, 16, true, 1)],
    ]);
    const [t] = rows(later, 'pool_types');
    expect(t).to.deep.include({
      pool_type: TYPE_HARD_16,
      mode: 1,
      tier: 0,
      capacity: 16,
      enabled: true,
      min_seats: 10,
      paid_places: 4,
      prize_table: [5, 3, 1, 1],
      pot_lamports: (10n * PRICE).toString(),
    });

    const off = await ingest([
      [typeInitialized(TYPE_HARD_16, 1, 16)],
      [typeEconomics(TYPE_HARD_16, 1, 16, 10)],
      [typeEnabled(TYPE_HARD_16, 1, 16, true, 1)],
      [typeEnabled(TYPE_HARD_16, 1, 16, false, 0)],
    ]);
    expect(rows(off, 'pool_types')[0].enabled).to.equal(false);
  });

  it('a slot stamp is the pool TYPE’s: keyed (mode, tier, capacity), and a pre-Ladder one is 64’s', async () => {
    const store = await ingest([
      [typeInitialized(TYPE_EASY_8, 0, 8)],
      [tierSlotFreed({ mode: 0, capacity: 8, poolId: 31n, nextOpenAt: 1_800_000_300n })],
      [tierSlotFreed({ mode: 1, poolId: 5n, nextOpenAt: 1_700_000_300n })], // pre-Ladder, hard
    ]);
    const status = rows(store, 'tier_status');
    expect(status).to.have.length(2);
    expect(status.find((r) => r.capacity === 8)).to.include({
      tier: 0,
      mode: 0,
      next_open_at: '1800000300',
      last_pool_id: '31',
    });
    expect(status.find((r) => r.capacity === 64)).to.include({ tier: 0, mode: 1, last_pool_id: '5' });

    const types = rows(store, 'pool_types');
    // The 8-player type's own row carries its stamp beside its address…
    expect(types.find((r) => r.capacity === 8)).to.include({
      pool_type: TYPE_EASY_8,
      next_open_at: '1800000300',
      last_pool_id: '31',
    });
    // …and the pre-Ladder stamp makes a row with no account behind it.
    expect(types.find((r) => r.capacity === 64)!.pool_type).to.equal(undefined);
  });

  it('rederive rebuilds every Ladder row from the ledger alone', async () => {
    const store = await ingest([
      [typeInitialized(TYPE_EASY_8, 0, 8)],
      [typeEconomics(TYPE_EASY_8, 0, 8, 5)],
      [typeEnabled(TYPE_EASY_8, 0, 8, true, 1)],
      [poolOpened({ pool: POOL, id: 31n, mode: 0, capacity: 8, minSeats: 5, table: LADDER_TABLES[8] })],
      [tierSlotFreed({ mode: 0, capacity: 8, poolId: 31n, nextOpenAt: 1_800_000_300n })],
      [preLadderPoolOpened(OLD_POOL, 9n)],
    ]);
    const live = JSON.parse(JSON.stringify(store.projection.snapshot()));
    expect(Object.keys(live.pool_types)).to.have.length(1);
    await store.rederive();
    expect(JSON.parse(JSON.stringify(store.projection.snapshot()))).to.deep.equal(live);
  });
});
