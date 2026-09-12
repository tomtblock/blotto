/**
 * `PgEventStore` and `PgProjection` against the schema the migrations build
 * (audit 2026-09-11, A-03 / G-03 / G-17).
 *
 * WHAT THIS IS FOR. `projection.ts` turns one decoded event into a list of
 * mechanical operations, and TWO executors run that list: `MemoryProjection`
 * and `PgProjection`. Everything in the repository ran the first one. The
 * second is 119 lines of hand-written SQL — an upsert whose conflict target
 * is built by string concatenation, an increment that has to COALESCE its own
 * NULL, a bit test evaluated in NUMERIC arithmetic, and `history_on_entry`,
 * which is a hand-written re-implementation of the memory executor's
 * fill-missing semantics with a CASE expression standing in for a JavaScript
 * spread (G-17). Two implementations of one rule set, one of them unexecuted.
 *
 * So the central case here is DIFFERENTIAL: drive the same real lifecycle
 * through both executors and require the derived tables to agree, column by
 * column. The fixture is `lifecycle-logs.json` — transaction logs the
 * compiled program emitted in LiteSVM — so the events are real bytes and the
 * comparison covers every rule the lifecycle exercises.
 *
 * WHAT IT STILL DOES NOT PROVE. The two executors are compared on the events
 * this fixture contains. A rule reachable only by an event sequence the
 * lifecycle never produces is still unchecked in Postgres; the answer to that
 * is a wider fixture, not a weaker comparison.
 */
import { expect } from 'chai';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Pool } from 'pg';
import { registerBlottoEventLayouts } from '../../../backend/_shared/src/blotto-events';
import { SILENT_MONITOR } from '../../../backend/indexer/src/shared';
import { ingestTransaction, type IngestContext } from '../../../backend/indexer/src/ingest';
import { MemoryProjection } from '../../../backend/indexer/src/projection';
import { PgProjection } from '../../../backend/indexer/src/projection-pg';
import { InMemoryEventStore } from '../../../backend/indexer/src/store';
import { PgEventStore } from '../../../backend/indexer/src/store-pg';
import { CONFIGURED, truncate } from '../src/db';
import { sharedDatabase } from '../src/schema';

const CTX: IngestContext = { commitment: 'confirmed', program: 'blotto_cup' };

const fixture = JSON.parse(
  readFileSync(
    join(__dirname, '../../../backend/indexer/test/fixtures/lifecycle-logs.json'),
    'utf8'
  )
) as { transactions: string[][] };

/** `SIG0000`-style name for the fixture's i-th transaction, as the indexer's own specs use. */
const sigFor = (i: number) => `SIG${String(i).padStart(4, '0')}`;

/** Every derived table, with its key columns — the projection's whole output. */
const DERIVED: ReadonlyArray<{ table: string; key: readonly string[] }> = [
  { table: 'pools', key: ['pool'] },
  { table: 'entries', key: ['pool', 'player'] },
  { table: 'results', key: ['pool', 'rank'] },
  { table: 'payouts', key: ['pool', 'rank'] },
  { table: 'profiles', key: ['player'] },
  { table: 'player_history', key: ['pool', 'player'] },
  { table: 'tier_status', key: ['tier'] },
];

/**
 * A payout landing BEFORE the entry it belongs to — the only sequence that
 * reaches `history_on_entry`'s conflict branch. Not a hypothetical: a
 * dropped `EntryRegistered` delivery repaired by a later backfill produces
 * exactly this order, and `projection-pg.ts` says so in its own comment.
 */
const HISTORY_POOL = 'Poo1H1story1111111111111111111111111111111';
const HISTORY_PLAYER = 'P1ayerH1story11111111111111111111111111111';
const OUT_OF_ORDER: ReadonlyArray<Record<string, unknown>> = [
  {
    event: 'PoolOpened',
    pool: HISTORY_POOL,
    id: 77n,
    tier: 0,
    entry_lamports: '70000000',
    pot_lamports: '4000000000',
    fill_deadline: '1757600000',
    timer_seconds: 15,
    sealing_pubkey: 'aa',
    sealing_secret_hash: 'bb',
  },
  {
    event: 'PrizesPaid',
    pool: HISTORY_POOL,
    paid_mask: '512',
    payouts: [
      { player: HISTORY_PLAYER, entry_index: 9, amount: '4000000000', escrowed: false },
    ],
  },
  {
    event: 'EntryRegistered',
    pool: HISTORY_POOL,
    player: HISTORY_PLAYER,
    index: 9,
    class: 2,
    battles_hash: 'cc',
    slot_hash: 'dd',
    pass_asset: 'ee',
    terms_version: 1,
  },
];

/**
 * One value, as a string, so a NUMERIC that `pg` hands back as `'4000000000'`
 * compares equal to the memory executor's `'4000000000'` and an INT it hands
 * back as `52` compares equal to the memory executor's `52`. Null and absent
 * are the same thing to this comparison: the memory executor simply omits a
 * column it has never written, where Postgres carries the table's default.
 */
function scalar(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

/** `{ pool: 'A', player: 'B' }` → `'pool=A|player=B'`, key columns sorted. */
function rowKey(row: Record<string, unknown>, key: readonly string[]): string {
  return [...key]
    .sort()
    .map((k) => `${k}=${scalar(row[k])}`)
    .join('|');
}

/** Read one derived table out of Postgres, keyed for comparison. */
async function pgTable(
  pool: Pool,
  table: string,
  key: readonly string[]
): Promise<Map<string, Record<string, unknown>>> {
  const res = await pool.query(`SELECT * FROM ${table}`);
  const out = new Map<string, Record<string, unknown>>();
  for (const row of res.rows as Record<string, unknown>[]) {
    out.set(rowKey(row, key), row);
  }
  return out;
}

/** Read one derived table out of the memory executor's snapshot, same keying. */
function memoryTable(
  snapshot: Record<string, Record<string, Record<string, unknown>>>,
  table: string,
  key: readonly string[]
): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const row of Object.values(snapshot[table] ?? {})) {
    out.set(rowKey(row, key), row);
  }
  return out;
}

/**
 * Compare one table across the two executors. Only the columns the memory
 * executor actually wrote are compared — it is the reference for the RULES,
 * not for the schema, and a Postgres column it never mentions (`bundles`'
 * timestamps, a default it did not set) is not a disagreement. A column it
 * DID write and Postgres did not is.
 */
function expectSameTable(
  table: string,
  mem: Map<string, Record<string, unknown>>,
  pg: Map<string, Record<string, unknown>>
): void {
  expect([...pg.keys()].sort(), `${table}: the two executors produced different rows`).to.deep.equal(
    [...mem.keys()].sort()
  );
  for (const [key, memRow] of mem) {
    const pgRow = pg.get(key)!;
    for (const column of Object.keys(memRow)) {
      expect(
        scalar(pgRow[column]),
        `${table}[${key}].${column}: Postgres says ${scalar(pgRow[column])}, the reference says ${scalar(memRow[column])}`
      ).to.equal(scalar(memRow[column]));
    }
  }
}

(CONFIGURED ? describe : describe.skip)('the Postgres event store and projection', function () {
  this.timeout(180_000);

  let pool: Pool;
  let store: PgEventStore;

  before(async () => {
    registerBlottoEventLayouts();
    pool = (await sharedDatabase()).pool;
    store = new PgEventStore(pool);
  });

  beforeEach(async () => {
    await truncate(pool, [
      'events',
      'pools',
      'entries',
      'results',
      'payouts',
      'profiles',
      'player_history',
      'tier_status',
    ]);
  });

  /** Drive the whole fixture through one store, live, one transaction per slot. */
  async function ingestAll(target: PgEventStore | InMemoryEventStore): Promise<void> {
    for (let i = 0; i < fixture.transactions.length; i++) {
      await ingestTransaction(target, SILENT_MONITOR, CTX, {
        signature: sigFor(i),
        slot: BigInt(i + 1),
        logs: fixture.transactions[i],
      });
    }
  }

  it('derives the same tables as the in-memory reference, column by column', async () => {
    const reference = new InMemoryEventStore();
    await ingestAll(reference);
    await ingestAll(store);

    const snapshot = reference.projection.snapshot();
    for (const { table, key } of DERIVED) {
      const mem = memoryTable(snapshot, table, key);
      // Guard against a vacuous pass: a comparison of two empty tables is
      // not evidence, and the lifecycle writes to all seven.
      expect(mem.size, `the reference produced no ${table} rows — the fixture or the ingest is broken`).to.be.greaterThan(0);
      expectSameTable(table, mem, await pgTable(pool, table, key));
    }
  });

  it('history_on_entry fills identity fields the same way in SQL as in JavaScript (G-17)', async () => {
    // The single rule with two hand-written implementations. Spelled out
    // separately from the table sweep above so a regression names itself.
    await ingestAll(store);
    const rows = await pool.query(
      `SELECT player, pool, tier, seat, entries_to_date::text AS entries_to_date,
              pot_lamports::text AS pot_lamports, paid, amount_lamports::text AS amount_lamports
         FROM player_history ORDER BY pool, seat`
    );
    expect(rows.rowCount, 'one row per entry in the lifecycle').to.equal(118);
    for (const r of rows.rows as Record<string, unknown>[]) {
      expect(r.tier, `player_history.tier for seat ${r.seat} was never filled from pools`).to.not.equal(null);
      expect(r.pot_lamports, `player_history.pot_lamports for seat ${r.seat}`).to.not.equal(null);
      expect(r.seat, 'player_history.seat').to.not.equal(null);
      expect(
        Number(r.entries_to_date),
        'entries_to_date is the profiles counter as of this entry, never the 0 default'
      ).to.be.greaterThan(0);
    }
  });

  it('the ledger row and its derived rows commit together, or not at all', async () => {
    // The claim `store-pg.ts`'s header makes — "a row that is in the ledger
    // but not projected, or the reverse, is the split-brain this seam exists
    // to prevent". Provable only against a real transaction: the projection
    // is made to fail on a real constraint mid-way through a real BEGIN, and
    // the ledger row must be gone with it.
    await ingestAll(store);
    const before = await pool.query('SELECT count(*)::int AS n FROM events');

    // `entries.idx` is an INT column; a value past its range is refused by
    // Postgres when the projection writes it, after the ledger insert in the
    // same transaction has already succeeded.
    const poolRow = await pool.query('SELECT pool FROM pools LIMIT 1');
    const poolPda = String((poolRow.rows[0] as { pool: string }).pool);
    let threw: Error | null = null;
    try {
      await store.ingest(
        {
          signature: 'SIGATOMIC',
          eventIndex: 0,
          slot: 9_999n,
          program: 'blotto_cup',
          name: 'EntryRegistered',
          raw: {
            event: 'EntryRegistered',
            pool: poolPda,
            player: 'AtomicProbePlayer111111111111111111111111111',
            index: 3_000_000_000,
            class: 0,
            battles_hash: '00',
            pass_asset: 'x',
            slot_hash: '00',
          },
          commitment: 'confirmed',
        },
        {
          event: 'EntryRegistered',
          pool: poolPda,
          player: 'AtomicProbePlayer111111111111111111111111111',
          index: 3_000_000_000,
          class: 0,
          battles_hash: '00',
          pass_asset: 'x',
          slot_hash: '00',
        } as never
      );
    } catch (e) {
      threw = e as Error;
    }
    expect(threw, 'the projection write must have been refused').to.not.equal(null);

    const after = await pool.query('SELECT count(*)::int AS n FROM events');
    expect(
      (after.rows[0] as { n: number }).n,
      'the ledger row survived a failed projection — the append is not atomic with it'
    ).to.equal((before.rows[0] as { n: number }).n);
    const stranded = await pool.query('SELECT 1 FROM events WHERE signature = $1', ['SIGATOMIC']);
    expect(stranded.rowCount).to.equal(0);
  });

  it('rejects a redelivery on the table`s own primary key, not only in the application', async () => {
    const record = {
      signature: 'SIGDUPLICATE',
      eventIndex: 2,
      slot: 41n,
      program: 'blotto_cup',
      name: 'TierSlotFreed',
      raw: { event: 'TierSlotFreed', tier: 0, next_open_at: '1757600000', pool_id: '1' },
      commitment: 'confirmed' as const,
    };
    const event = { event: 'TierSlotFreed', tier: 0, next_open_at: 1_757_600_000n, pool_id: 1n };
    expect(await store.ingest(record, event as never)).to.equal('inserted');
    expect(await store.ingest(record, event as never)).to.equal('duplicate');
    const res = await pool.query('SELECT count(*)::int AS n FROM events WHERE signature = $1', [
      'SIGDUPLICATE',
    ]);
    expect((res.rows[0] as { n: number }).n).to.equal(1);
    // The second call must not have re-applied the projection either: a
    // duplicate that increments a counter twice is the bug the outcome value
    // exists to prevent.
    const tier = await pool.query('SELECT count(*)::int AS n FROM tier_status');
    expect((tier.rows[0] as { n: number }).n).to.equal(1);
  });

  it('rederive rebuilds the identical tables from the ledger alone', async () => {
    await ingestAll(store);
    const live: Record<string, Map<string, Record<string, unknown>>> = {};
    for (const { table, key } of DERIVED) live[table] = await pgTable(pool, table, key);

    const replayed = await store.rederive();
    expect(replayed, 'every ledger row is replayed').to.equal(
      (await pool.query('SELECT count(*)::int AS n FROM events')).rows[0].n
    );

    for (const { table, key } of DERIVED) {
      const after = await pgTable(pool, table, key);
      expect([...after.keys()].sort(), `${table} after a re-derive`).to.deep.equal(
        [...live[table].keys()].sort()
      );
      for (const [k, row] of live[table]) {
        for (const column of Object.keys(row)) {
          expect(scalar(after.get(k)![column]), `${table}[${k}].${column}`).to.equal(
            scalar(row[column])
          );
        }
      }
    }
  });

  it('the SQL and the JavaScript agree when the history row already exists (G-17)', async () => {
    // THE PATH THE LIFECYCLE NEVER TAKES, and the reason a fixture replay is
    // not enough on its own. `history_on_entry` exists to fill identity
    // fields into a `player_history` row that a payout event created FIRST —
    // the ON CONFLICT branch of the SQL, and the trailing spread of the
    // JavaScript. Breaking either one leaves the fixture sweep above green,
    // because in ledger order the entry always arrives first. So the two
    // executors are driven here through the out-of-order sequence directly.
    const reference = new MemoryProjection();
    const sql = new PgProjection(pool);
    for (const event of OUT_OF_ORDER) {
      await reference.apply(event as never);
      await sql.apply(event as never);
    }

    const mem = memoryTable(reference.snapshot(), 'player_history', ['pool', 'player']);
    const pg = await pgTable(pool, 'player_history', ['pool', 'player']);
    expect(mem.size, 'the reference wrote a history row').to.equal(1);
    expectSameTable('player_history', mem, pg);
    // And say what the agreed answer IS, so a change that makes both
    // executors wrong in the same way is still visible.
    const row = [...pg.values()][0];
    expect(scalar(row.seat), 'the seat the entry event carried').to.equal('9');
    expect(scalar(row.tier), 'the tier copied from the pools row').to.equal('0');
    expect(scalar(row.pot_lamports)).to.equal('4000000000');
    expect(scalar(row.entries_to_date), 'the profiles counter as of this entry').to.equal('1');
    expect(scalar(row.paid), 'the payout that arrived first is not overwritten').to.equal('true');
    expect(scalar(row.amount_lamports)).to.equal('4000000000');
  });

  it('lastIngestedSlot and knownSignatures answer from the rows, not from a cache', async () => {
    expect(await store.lastIngestedSlot(), 'an empty ledger has no watermark').to.equal(null);
    await ingestAll(store);
    expect(await store.lastIngestedSlot()).to.equal(BigInt(fixture.transactions.length));
    const known = await store.knownSignatures([sigFor(0), 'SIGNOTHERE', sigFor(3)]);
    expect([...known].sort()).to.deep.equal([sigFor(0), sigFor(3)].sort());
    expect(await store.knownSignatures([])).to.deep.equal(new Set());
  });
});
