/**
 * Event store — the persistence seam behind ingest. The webhook and the backfill
 * reconciler both write through `ingest`, so a signature seen by both paths yields
 * exactly one ledger row.
 *
 * Two implementations share these semantics:
 *   - `InMemoryEventStore` (here) — the offline-test reference; no database.
 *   - `PgEventStore` (`./store-pg`) — Postgres, with a real `(signature,
 *     event_index)` unique constraint.
 *
 * `ingest` is idempotent: a `(signature, event_index)` already in the ledger
 * returns `'duplicate'`. That is idempotency at the application layer; the SQL
 * UNIQUE constraint enforces the same thing at the storage layer, and BOTH are
 * deliberate — the application check keeps the common redelivery cheap, the
 * constraint makes a race impossible.
 *
 * ## What was carried, and what was not
 *
 * Carried from the predecessor repository: the raw-jsonb ledger, the idempotency
 * key, the two-implementation shape, and the re-derive contract.
 *
 * NOT carried: the derived-table projection. The predecessor projected each event
 * into one of four product-specific tables, and every one of those tables
 * described the old product. The ledger below is generic and complete on its own.
 *
 * TODO(phase-2): add this product's derived tables and a projection back onto this
 * seam, driven by the TECH-ARCH §3.3 event list. The ledger stays the source of
 * truth and the derived tables stay a pure function of it — which is what
 * `rederive()` exists to prove. A derived table that cannot be rebuilt from the
 * ledger alone has become a second source of truth, and the reveal, scoring and
 * claim pipeline depends on there being only one.
 */

import { eventFromJson, type DecodedEvent } from './shared';

/** A row as written to the `events` ledger. `raw` is the decoded event, bigints as strings. */
export interface LedgerRecord {
  signature: string;
  eventIndex: number;
  slot: bigint;
  /** The emitting program, base58 — recorded, not assumed. */
  program: string;
  /** The event name, from the decoded discriminator. */
  name: string;
  /** The decoded event, every u64 as a decimal string. */
  raw: Record<string, unknown>;
  commitment: string;
}

export type IngestOutcome = 'inserted' | 'duplicate';

export interface EventStore {
  /**
   * Idempotently append to the ledger.
   *
   * Takes the decoded `event` as well as the record because Phase 2's projection
   * needs it, and because it must run in the SAME transaction as the append — a
   * ledger row without its projection, or the reverse, is exactly the split-brain
   * this seam exists to prevent.
   */
  ingest(record: LedgerRecord, event: DecodedEvent): Promise<IngestOutcome>;
  /** Highest slot in the ledger, or null if empty — the ingest watermark. */
  lastIngestedSlot(): Promise<bigint | null>;
  /** Rebuild every derived table from the ledger alone. Returns events replayed. */
  rederive(): Promise<number>;
  close(): Promise<void>;
}

function ledgerKey(signature: string, eventIndex: number): string {
  return `${signature}:${eventIndex}`;
}

/**
 * In-memory store, backing the ledger with a Map keyed `(signature, event_index)`.
 * The reference semantics the Postgres store must match.
 */
export class InMemoryEventStore implements EventStore {
  private readonly events = new Map<string, LedgerRecord>();

  async ingest(record: LedgerRecord, _event: DecodedEvent): Promise<IngestOutcome> {
    const key = ledgerKey(record.signature, record.eventIndex);
    if (this.events.has(key)) {
      return 'duplicate';
    }
    this.events.set(key, record);
    // TODO(phase-2): project `_event` into the derived tables here, atomically
    // with the append above.
    return 'inserted';
  }

  async lastIngestedSlot(): Promise<bigint | null> {
    let max: bigint | null = null;
    for (const record of this.events.values()) {
      if (max === null || record.slot > max) max = record.slot;
    }
    return max;
  }

  /**
   * Replay the whole ledger in `(slot, signature, event_index)` order.
   *
   * Ordering is load-bearing and not incidental: a projection that depends on
   * event order — which every stateful one does — must see the same order on a
   * rebuild as it saw live, or a rebuild produces different derived rows from the
   * same ledger.
   */
  async rederive(): Promise<number> {
    const ordered = [...this.events.values()].sort(
      (a, b) =>
        Number(a.slot - b.slot) ||
        a.signature.localeCompare(b.signature) ||
        a.eventIndex - b.eventIndex
    );
    for (const record of ordered) {
      // Parsing on replay is deliberate: it exercises the same decode path a live
      // ingest uses, so a ledger row that can no longer be read is found by a
      // re-derive rather than by a silent gap in a derived table.
      eventFromJson(record.raw);
      // TODO(phase-2): re-apply the projection for this event.
    }
    return ordered.length;
  }

  /** Every ledger row, in insertion order. Test/inspection helper. */
  ledger(): readonly LedgerRecord[] {
    return [...this.events.values()];
  }

  async close(): Promise<void> {
    this.events.clear();
  }
}
