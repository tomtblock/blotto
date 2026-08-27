/**
 * Ingest pipeline — the ONE write path both the webhook (§3) and the backfill reconciler (§4)
 * funnel through, so a signature observed by both yields identical rows with zero double-count
 * (convergence). Steps: decode the tx's logs → for each recognized event, build its ledger
 * record → idempotently ingest (append + project). Reports health through `Monitor`.
 *
 * Decode/ingest failures are isolated per transaction by the caller (the receiver must not crash
 * on one bad delivery, §6); this function surfaces counts but a thrown store error propagates so
 * the caller can decide (webhook: log + 200-or-500; backfill: abort the run).
 */
import {
  decodeEventsFromLogs,
  eventToJson,
  METRIC,
  type Monitor,
} from './shared';
import type { EventStore, LedgerRecord } from './store';

/** The minimal transaction view ingest needs — identical from a webhook or an RPC fetch. */
export interface TxContext {
  signature: string;
  slot: bigint;
  logs: readonly string[];
}

/**
 * What every ledger row records about HOW it was ingested, as opposed to what was
 * ingested.
 *
 * `program` is recorded per row rather than assumed, so a ledger that ever ingests
 * from more than one program stays unambiguous — and so a row can be attributed
 * without consulting the config that was in force when it was written.
 */
export interface IngestContext {
  commitment: string;
  program: string;
}

export interface IngestStats {
  /** Recognized events decoded from the logs. */
  decoded: number;
  /** Newly appended to the ledger. */
  inserted: number;
  /** Already present — redelivery/replay suppressed. */
  duplicates: number;
}

/**
 * Ingest every recognized event in one transaction's logs. Idempotent: re-running with the same
 * `(signature, logs)` inserts nothing new (every event is a `'duplicate'`).
 */
export async function ingestTransaction(
  store: EventStore,
  monitor: Monitor,
  ctx: IngestContext,
  tx: TxContext
): Promise<IngestStats> {
  const stats: IngestStats = { decoded: 0, inserted: 0, duplicates: 0 };
  // OF-2 safety net: a KNOWN event whose body won't decode (a decoder lagging the deployed layout —
  // the failure mode behind KI-001) bumps a counter instead of being silently dropped.
  const onUndecodable = (eventName: string): void =>
    monitor.recordEvent(METRIC.indexer.recognizedButUndecodable, { event: eventName });
  for (const { eventIndex, event } of decodeEventsFromLogs(tx.logs, onUndecodable)) {
    stats.decoded++;
    const record: LedgerRecord = {
      signature: tx.signature,
      eventIndex,
      slot: tx.slot,
      program: ctx.program,
      name: event.event,
      raw: eventToJson(event),
      commitment: ctx.commitment,
    };
    const outcome = await store.ingest(record, event);
    if (outcome === 'inserted') {
      stats.inserted++;
      monitor.recordEvent(METRIC.indexer.ingested, { event: event.event });
    } else {
      stats.duplicates++;
      monitor.recordEvent(METRIC.indexer.duplicate, { event: event.event });
    }
  }
  // Slot fits comfortably in a JS number for a gauge (~3e8 today, ceiling ~9e15); never used for
  // storage, where slots stay bigint/NUMERIC.
  monitor.reportGauge(METRIC.indexer.lastSlot, Number(tx.slot));
  return stats;
}
