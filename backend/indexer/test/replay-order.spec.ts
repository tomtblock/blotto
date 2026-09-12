/**
 * Ledger replay order (audit F-19).
 *
 * THE DEFECT. Every replay of the ledger ordered by
 * `(slot, signature, event_index)`. `event_index` is the ordinal within ONE
 * transaction's logs, so it orders nothing across transactions, and
 * `signature` is a base58 transaction hash — so two of our transactions in the
 * same slot replayed in an order decided by base58 collation. That is a
 * per-pair coin-flip, uncorrelated with the order the chain executed them in
 * and uncorrelated with the order the live run applied them in. Both stores
 * call the replay order "load-bearing" precisely because a rebuild must
 * reproduce what the live run saw.
 *
 * THE FIX. `events.seq` (0018_events_seq.sql), an insertion sequence assigned
 * by the database, modelled in the in-memory store by a counter. The order
 * becomes `(slot, seq)`.
 *
 * THE HONEST LIMIT, which these tests state rather than paper over: for two
 * LIVE webhook deliveries that share a slot, `seq` is DELIVERY order, not chain
 * order. The webhook payload carries no intra-slot position and neither does
 * `getSignaturesForAddress`, so the chain never tells us which of the two ran
 * first. That is survivable only because the projection does not depend on the
 * order of the events that can realistically share a slot — which is what the
 * last suite here checks, on the realistic case.
 */
import { expect } from 'chai';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Pool } from 'pg';
import { SILENT_MONITOR, decodeEventsFromLogs, type DecodedEvent } from '../src/shared';
import { registerBlottoEventLayouts } from '../../_shared/src/blotto-events';
import { InMemoryEventStore } from '../src/store';
import { PgEventStore } from '../src/store-pg';
import { MemoryProjection } from '../src/projection';
import { ingestTransaction, type IngestContext } from '../src/ingest';

const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'lifecycle-logs.json'), 'utf8')
) as { transactions: string[][] };

const CTX: IngestContext = { commitment: 'confirmed', program: 'blotto_cup' };

/** A projection that records the order events reach it, then behaves normally. */
class RecordingProjection extends MemoryProjection {
  readonly seen: string[] = [];

  override async apply(event: DecodedEvent): Promise<void> {
    this.seen.push(event.event);
    await super.apply(event);
  }
}

/** Every event in one fixture transaction, decoded. */
function eventsOf(txIndex: number): DecodedEvent[] {
  return [...decodeEventsFromLogs(fixture.transactions[txIndex], () => {})].map((d) => d.event);
}

/**
 * A `pg.Pool` stand-in that records the SQL it is handed and answers every
 * query with no rows. Enough for `PgEventStore.rederive`, whose contract here
 * is the ORDER BY clause it sends, not what comes back.
 */
function capturingPool(): { pool: Pool; sql: string[] } {
  const sql: string[] = [];
  const query = async (text: string): Promise<never> => {
    sql.push(text);
    return { rows: [], rowCount: 0 } as never;
  };
  const client = { query, release: (): void => undefined };
  const pool = { query, connect: async () => client };
  return { pool: pool as unknown as Pool, sql };
}

describe('ledger replay order (audit F-19)', () => {
  before(() => {
    registerBlottoEventLayouts();
  });

  it('the in-memory store replays two same-slot rows in the order they arrived', async () => {
    // Two transactions in ONE slot, delivered in the REVERSE of their base58
    // collation, carrying different events so the replay order is observable.
    // Under the old `(slot, signature, event_index)` sort the replay put the
    // `AAA…` row first — which is neither what the live run saw nor anything
    // the chain said, just how two hashes happened to sort.
    const deliveredFirst = 'ZZZZ0000000000000000000000000000000000000000';
    const deliveredSecond = 'AAAA0000000000000000000000000000000000000000';

    const projection = new RecordingProjection();
    const store = new InMemoryEventStore(projection);
    await ingestTransaction(store, SILENT_MONITOR, CTX, {
      signature: deliveredFirst,
      slot: 100n,
      logs: fixture.transactions[86], // PoolVrfSeeded
    });
    await ingestTransaction(store, SILENT_MONITOR, CTX, {
      signature: deliveredSecond,
      slot: 100n,
      logs: fixture.transactions[1], // PoolOpened
    });
    const live = [...projection.seen];
    expect(live, 'the fixture rows must be distinguishable for this to mean anything').to.deep.equal(
      ['PoolVrfSeeded', 'PoolOpened']
    );

    projection.seen.length = 0;
    await store.rederive();
    expect(
      projection.seen,
      'a rebuild must see what the live run saw, not what base58 sorts to'
    ).to.deep.equal(live);
  });

  it('slot still dominates the insertion sequence', async () => {
    // A late delivery for an EARLIER slot replays FIRST, ahead of the row
    // appended before it. `seq` is only the tiebreak within one slot.
    const projection = new RecordingProjection();
    const store = new InMemoryEventStore(projection);
    await ingestTransaction(store, SILENT_MONITOR, CTX, {
      signature: 'SIGslot200',
      slot: 200n,
      logs: fixture.transactions[86], // PoolVrfSeeded
    });
    await ingestTransaction(store, SILENT_MONITOR, CTX, {
      signature: 'SIGslot100',
      slot: 100n,
      logs: fixture.transactions[1], // PoolOpened
    });
    expect(projection.seen).to.deep.equal(['PoolVrfSeeded', 'PoolOpened']);

    projection.seen.length = 0;
    await store.rederive();
    expect(projection.seen, 'the lower slot replays first').to.deep.equal([
      'PoolOpened',
      'PoolVrfSeeded',
    ]);
  });

  it('the Postgres store orders by slot then seq, and by nothing else', async () => {
    const { pool, sql } = capturingPool();
    await new PgEventStore(pool).rederive();
    const select = sql.find((s) => /SELECT[\s\S]*FROM events/.test(s));
    expect(select, 'the replay reads the ledger').to.be.a('string');
    const normalised = select!.replace(/\s+/g, ' ').trim();
    expect(normalised).to.match(/ORDER BY slot, seq$/);
    // The two columns that ordered nothing must not be back.
    expect(/ORDER BY[\s\S]*signature/.test(normalised)).to.equal(false);
    expect(/ORDER BY[\s\S]*event_index/.test(normalised)).to.equal(false);
  });
});

/**
 * The property that makes the honest limit above survivable.
 *
 * Two of our transactions land in one slot when two players register at the
 * same moment — by a wide margin the most common way it happens, and the only
 * one that happens by the hundred. For those, the projection's result must not
 * depend on which order they are applied in, because for two live webhook
 * deliveries nothing can tell us the true one.
 */
describe('the projection does not depend on intra-slot order for same-slot events', () => {
  before(() => {
    registerBlottoEventLayouts();
  });

  it('two EntryRegistered for one pool commute', async () => {
    const opened = eventsOf(1); // PoolOpened, the 64-seat pool
    const entryA = eventsOf(3);
    const entryB = eventsOf(4);
    expect(opened.map((e) => e.event)).to.deep.equal(['PoolOpened']);
    expect(entryA.map((e) => e.event)).to.deep.equal(['EntryRegistered']);
    expect(entryB.map((e) => e.event)).to.deep.equal(['EntryRegistered']);
    expect(entryA[0].pool, 'both entries are for the same pool').to.equal(entryB[0].pool);
    expect(entryA[0].player).to.not.equal(entryB[0].player);

    const apply = async (order: DecodedEvent[]): Promise<unknown> => {
      const projection = new MemoryProjection();
      for (const e of [...opened, ...order]) await projection.apply(e);
      return JSON.parse(JSON.stringify(projection.snapshot()));
    };

    const ab = await apply([...entryA, ...entryB]);
    const ba = await apply([...entryB, ...entryA]);
    expect(ba, 'same-slot entries must project identically either way').to.deep.equal(ab);

    // Not a vacuous pass: the rows that would differ are actually there.
    const rows = ab as Record<string, Record<string, Record<string, unknown>>>;
    expect(Object.keys(rows.entries)).to.have.lengthOf(2);
    expect(Object.values(rows.pools)[0].entrants).to.equal('2');
    expect(Object.keys(rows.player_history)).to.have.lengthOf(2);
    for (const h of Object.values(rows.player_history)) {
      expect(h.entries_to_date, 'each player counts only their own entries').to.equal('1');
    }
  });

  it('a whole slot of registrations commutes, forwards against backwards', async () => {
    // The same claim at scale, and with the adversarial order: 32 consecutive
    // registrations applied in reverse. Every one of them increments the same
    // pool counter and reads the same pool row, so if any of that were order-
    // dependent this is where it would show.
    const opened = eventsOf(1);
    const entries: DecodedEvent[] = [];
    for (let i = 3; i < 35; i++) entries.push(...eventsOf(i));
    expect(entries.length).to.equal(32);
    expect(entries.every((e) => e.event === 'EntryRegistered')).to.equal(true);

    const apply = async (order: DecodedEvent[]): Promise<unknown> => {
      const projection = new MemoryProjection();
      for (const e of [...opened, ...order]) await projection.apply(e);
      return JSON.parse(JSON.stringify(projection.snapshot()));
    };

    expect(await apply([...entries].reverse())).to.deep.equal(await apply(entries));
  });
});
