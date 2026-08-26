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
      // TODO(phase-2): project `event` into the derived tables HERE, inside this
      // same transaction. See the note at the top of this file.
      void event;
      void client;
      return 'inserted';
    });
  }

  async lastIngestedSlot(): Promise<bigint | null> {
    const res = await this.pool.query('SELECT MAX(slot) AS max FROM events');
    const max = res.rows[0]?.max;
    return max === null || max === undefined ? null : BigInt(max);
  }

  async rederive(): Promise<number> {
    return withTransaction(this.pool, async (client) => {
      // TODO(phase-2): TRUNCATE the derived tables here before the replay. There
      // are none yet, so this is a read-only pass that proves every ledger row is
      // still decodable — worth keeping even now, because a row that can no
      // longer be read is found here rather than as a silent gap later.
      const res = await client.query(
        `SELECT signature, event_index, slot, raw
           FROM events
          ORDER BY slot, signature, event_index`
      );
      for (const row of res.rows) {
        // Ordering above is load-bearing: an order-dependent projection must see
        // the same order on a rebuild as it saw live, or a rebuild produces
        // different derived rows from the same ledger.
        eventFromJson(row.raw as Record<string, unknown>);
        // TODO(phase-2): re-apply the projection for this event.
      }
      return res.rowCount ?? 0;
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
