/**
 * Central metric- and alert-name registry for every off-chain service.
 *
 * Carried from the predecessor repository, with the services that do not exist
 * here removed. The names are the WIRE CONTRACT a Prometheus sink scrapes and
 * alerts on, so they are collected in one auditable place rather than scattered as
 * string literals across the services.
 *
 * Naming rules:
 *  - underscore `<service>_<metric>` — Prometheus forbids dots in metric names.
 *  - a `service` label is attached to EVERY series; it is injected centrally by
 *    `buildMonitor` (see `monitor.ts`) so it can never be forgotten at a call
 *    site, rather than hand-written per call.
 *  - high-cardinality dimensions (per-pool, per-player, per-slot values) are kept
 *    OUT of metric labels and pushed into `alert()` detail and logs instead. The
 *    retained labels are bounded sets only (`event`, `gate`, `reason`, `ok`). This
 *    is a cost control, and also a privacy one: a per-player label would put entry
 *    behaviour into a metrics store that is not the place for it.
 *
 * Zero imports by design: pure string constants, so any consumer can import this
 * without dragging `pg` or an SDK into its typecheck.
 *
 * TODO(phase-2 / phase-4): add namespaces for the services that do not exist yet —
 * `sealing` (ciphertext store, key export, reveal), `packet` (entry-packet
 * issuance and its rejection reasons), `detection` (signals raised, entries
 * flagged, review outcomes), and `reveal` (scoring runs, results committed).
 *
 * Two of those carry a rule worth deciding BEFORE the metric exists, not after:
 *  - A packet REJECTION must never be labelled with the reason a caller was
 *    refused. The endpoint returns a generic rejection precisely so a caller
 *    cannot learn which check failed, and a `reason` label would leak the same
 *    thing to anyone with dashboard access.
 *  - A detection FLAG rate is an operational signal, but per-player detail is not.
 *    The review page is where a decision is inspected; the metric is a count.
 */

/** Counter and gauge metric names, grouped by emitting service. */
export const METRIC = {
  indexer: {
    /** Counter: a recognised event was newly appended to the ledger (label `event`). */
    ingested: 'indexer_ingested',
    /** Counter: a redelivery or replay was suppressed by the ledger key (label `event`). */
    duplicate: 'indexer_duplicate',
    /**
     * Counter (label `event`): a known event discriminator was matched but its
     * Borsh body could not be decoded.
     *
     * The safety net for a decoder lagging the deployed layout. Without it that
     * failure is invisible — the event is dropped, the ledger looks healthy, and
     * the gap surfaces much later as a pool that will not reconstruct.
     */
    recognizedButUndecodable: 'indexer_event_recognized_but_undecodable',
    /** Gauge: the slot of the most recently ingested transaction (slot-lag reference). */
    lastSlot: 'indexer_last_slot',
    /** Counter: a `migrate` run applied N migrations. */
    migrate: 'indexer_migrate',
    /** Counter: a `re-derive` run replayed the ledger. */
    rederive: 'indexer_rederive',
    /** Counter: a `backfill` reconciler run completed. */
    backfillComplete: 'indexer_backfill_complete',
    /** Counter: a webhook delivery failed the shared-secret check (auth drift signal). */
    webhookUnauthorized: 'indexer_webhook_unauthorized',
    /** Counter: an announced or backfilled bundle recomputed to the on-chain root (E3). */
    archiveVerified: 'indexer_archive_verified',
  },
} as const;

/**
 * Loud-alert reason strings — the `reason` passed to `Monitor.alert`. The
 * Prometheus sink also surfaces each as a `blotto_alerts_total{reason=...}`
 * counter so a dashboard can page on it. A bounded set, one per operational
 * failure mode, which is what makes it safe as a metric label.
 */
export const ALERT = {
  indexer: {
    ingestFailed: 'indexer webhook ingest failed',
    handlerThrew: 'indexer webhook handler threw',
    /**
     * E3: a published bundle FAILED the Merkle-root check against the
     * on-chain `results_root`. Either the publish is corrupt or someone
     * is serving forged results under our tags — both are incidents, and
     * the archive stops serving that pool either way (fail-closed).
     */
    archiveRootMismatch: 'indexer archive bundle root mismatch',
    /**
     * The `sync` boot path's catch-up backfill failed.
     *
     * Deliberately non-fatal since 2026-09-08 — the service keeps serving and
     * the webhook keeps ingesting — which is exactly why it must be loud. A
     * failure here means the recovery path for dropped webhooks is not running,
     * and nothing else in the system will notice.
     */
    startupBackfillFailed: 'indexer startup backfill failed',
  },
} as const;

/**
 * Metrics that must NEVER raise an alert, only feed a dashboard panel.
 *
 * Empty today because every metric above is genuinely alertable. The mechanism is
 * carried because the case it exists for recurs: a counter that increments during
 * NORMAL operation of a deliberately-gated feature. Paging on one of those is
 * on-call spam, and the predecessor learned it the expensive way.
 *
 * The first entries here will almost certainly be the packet endpoint's rejection
 * counter — a refused entry from a blocked territory is the system working — and
 * the detection layer's flag counter.
 */
export const NEVER_ALERT_METRICS: readonly string[] = [];

/** True if a metric name is allowed to drive an alert rule (see {@link NEVER_ALERT_METRICS}). */
export function isAlertableMetric(name: string): boolean {
  return !NEVER_ALERT_METRICS.includes(name);
}
