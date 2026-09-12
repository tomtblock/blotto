/**
 * Postgres event store — the production implementation of `EventStore`. Mirrors
 * `InMemoryEventStore` semantics over real tables, and `(signature, event_index)`
 * is enforced by the table's PRIMARY KEY, so idempotency holds at the storage
 * layer and not only in the application.
 *
 * The insert runs inside a transaction even though it is currently a single
 * statement. That is deliberate: Phase 2's projection must commit ATOMICALLY with
 * the ledger append — a row that is in the ledger but not projected, or the
 * reverse, is the split-brain this seam exists to prevent — and the transaction
 * boundary is easier to keep than to add back later.
 *
 * Amounts are bound as decimal strings so the `pg` driver hands the full-width
 * value to NUMERIC without any float coercion. A prize amount rounded by a float
 * is a payment bug.
 */
import type { Pool } from 'pg';
import { eventFromJson, withTransaction, type DecodedEvent } from './shared';
import type { EventStore, IngestOutcome, LedgerRecord } from './store';
import { PgProjection } from './projection-pg';

export class PgEventStore implements EventStore {
  constructor(private readonly pool: Pool) {}

  async ingest(
    record: LedgerRecord,
    event: DecodedEvent
  ): Promise<IngestOutcome> {
    return withTransaction(this.pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO events (signature, event_index, slot, program, name, raw, commitment)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (signature, event_index) DO NOTHING
         RETURNING 1`,
        [
          record.signature,
          record.eventIndex,
          record.slot.toString(),
          record.program,
          record.name,
          JSON.stringify(record.raw),
          record.commitment,
        ]
      );
      if (inserted.rowCount === 0) {
        return 'duplicate';
      }
      // The projection commits atomically with the append (same client, same
      // transaction) — a ledger row and its derived rows land together or not
      // at all.
      await new PgProjection(client).apply(event);
      return 'inserted';
    });
  }

  async lastIngestedSlot(): Promise<bigint | null> {
    const res = await this.pool.query('SELECT MAX(slot) AS max FROM events');
    const max = res.rows[0]?.max;
    return max === null || max === undefined ? null : BigInt(max);
  }

  async knownSignatures(signatures: readonly string[]): Promise<Set<string>> {
    if (signatures.length === 0) return new Set();
    // One statement, one bind parameter, however long the list: `= ANY($1)`
    // takes the whole array, where a generated `IN (...)` would build a
    // different query plan per page size and a different statement per run.
    const res = await this.pool.query(
      'SELECT DISTINCT signature FROM events WHERE signature = ANY($1)',
      [signatures as string[]]
    );
    return new Set(res.rows.map((r: { signature: string }) => r.signature));
  }

  /**
   * Rebuild every derived table from the ledger alone, replaying in
   * `(slot, seq)` order.
   *
   * ORDERING IS LOAD-BEARING: an order-dependent projection must see the same
   * order on a rebuild as it saw live, or a rebuild produces different derived
   * rows from the same ledger. Decoding on replay also proves every ledger row
   * is still readable.
   *
   * `seq` is the `events` insertion sequence (0018_events_seq.sql). It replaced
   * `signature, event_index` here, which ordered nothing: `event_index` is the
   * ordinal within ONE transaction's logs, and `signature` is a base58 hash, so
   * two of our transactions in the same slot replayed in an order uncorrelated
   * with how the chain executed them (audit F-19).
   *
   * What `(slot, seq)` buys, precisely:
   *   - The order is deterministic and stable. Two rebuilds of one ledger agree,
   *     and a rebuild reproduces what the previous rebuild produced.
   *   - For rows the backfill wrote it IS chain order, because `runBackfill`
   *     ingests oldest-first.
   *   - For two LIVE webhook deliveries that share a slot it is DELIVERY order.
   *     That is not the same as chain order and this does not pretend it is: the
   *     webhook payload carries no intra-slot position, so the chain never tells
   *     us which of the two ran first. Delivery order is what we observed, it is
   *     recorded, and it replays identically — which is the property a rebuild
   *     actually needs.
   */
  async rederive(): Promise<number> {
    return withTransaction(this.pool, async (client) => {
      const projection = new PgProjection(client);
      await projection.reset();
      const res = await client.query(
        `SELECT signature, event_index, slot, raw
           FROM events
          ORDER BY slot, seq`
      );
      for (const row of res.rows) {
        await projection.apply(eventFromJson(row.raw as Record<string, unknown>));
      }
      return res.rowCount ?? 0;
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
