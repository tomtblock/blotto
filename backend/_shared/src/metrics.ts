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
 * `sealing` (ciphertext store, key export, reveal). `reveal` landed 2026-09-12 with
 * the daemon's first Monitor wiring (audit 2026-09-11, E-04): the tick, the review
 * clock's holds, and bundle publication, joined the same day by the persisted
 * detection report (A-18). `review` landed with it — the review desk's decisions,
 * its refusals, and the three states no response body reaches (B-24 / B-25 /
 * C-07). What is still missing from the detection layer is the per-signal counter:
 * how often each of the five fires, which is a tuning number rather than an
 * operational one. The `packet` namespace below covers the entry gate's UPSTREAM
 * health only; its issuance counters are still to come.
 *
 * Two of those carry a rule worth deciding BEFORE the metric exists, not after,
 * and the first is already load-bearing for the `packet` names below:
 *  - A packet REJECTION must never be labelled with the reason a caller was
 *    refused. The endpoint returns a generic rejection precisely so a caller
 *    cannot learn which check failed, and a `reason` label would leak the same
 *    thing to anyone with dashboard access. A VENDOR failure is a different
 *    thing and is labelled freely: it describes our upstream, not an entrant.
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
    /** Counter: one recurring reconciliation walk completed (audit C-11 / C-21). */
    reconciled: 'indexer_reconciled',
    /**
     * Counter: a recurring reconciliation walk FOUND something — a delivery
     * the webhook never brought us. Healthy is zero for ever; any value at all
     * means the live feed is lossy and the gap was repaired after the fact.
     */
    reconciledGap: 'indexer_reconciled_gap',
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
  reveal: {
    /** Counter (label `outcome`: ok|failed): the settlement daemon completed a tick. */
    tick: 'reveal_tick',
    /**
     * Counter (label `reason`): the keeper opened NO pool on this tick, and
     * why — a tier the founder has not enabled, a tier still cooling down, a
     * tier whose previous pool has not settled, or a treasury that cannot
     * fund the next pot (founder instruction 2026-09-12 §2.2).
     *
     * The reason matters more than the count. "No tier is enabled" is the
     * launch posture working as intended and should be the steady state for
     * six of seven tiers; the same silence caused by a treasury shortfall or
     * a stuck previous pool is an incident. Until this existed both looked
     * identical from outside the process — one log line and no signal.
     */
    keeperHold: 'reveal_keeper_hold',
    /**
     * Counter (label `reason`: sanctions_hold|forfeit_logged): the review clock
     * left a held share where it was instead of releasing it — a sanctions hold
     * the program would refuse anyway, or a reviewer's forfeit already logged
     * and waiting for its on-chain transaction (audit 2026-09-11, B-30 / D-03).
     */
    releaseHeld: 'reveal_release_held',
    /** Counter: a settled pool's reveal bundle was published for the first time. */
    bundlePublished: 'reveal_bundle_published',
    /** Counter: a publish attempt failed; the daemon retries on a later tick. */
    bundlePublishFailed: 'reveal_bundle_publish_failed',
    /**
     * Counter (label `outcome`: clean|findings): one detection run over a
     * settled pool was PERSISTED (audit 2026-09-11, A-18; ruling D-E9). The
     * label is bounded and carries no player.
     */
    detectionReport: 'reveal_detection_report',
    /** Counter: a detection run was computed but could not be persisted. */
    detectionReportUnstored: 'reveal_detection_report_unstored',
  },
  review: {
    /**
     * Counter (label `action`: flag|clear|release|forfeit|appeal_*): one
     * signed review decision was accepted. Per-player detail is deliberately
     * absent — the review page is where a decision is inspected (header rule).
     */
    decision: 'review_decision',
    /**
     * Counter (label `reason`: unauthorized|replay|precondition|budget|rule):
     * a submission was refused.
     *
     * The reason IS labelled here, and the entry gate's rule that a rejection
     * must never be (see this file's header) does not reach: that rule exists
     * because an ENTRANT must not learn which compliance check refused them.
     * A reviewer is an operator, the label describes our own review desk, and
     * a refusal counter with no reason on the one internet-facing service
     * that holds the settlement key is close to useless.
     */
    decisionRefused: 'review_decision_refused',
  },
  packet: {
    /**
     * Counter (label `reason`: quota|credential|budget|fault): a geo source
     * could not answer.
     *
     * The label describes the VENDOR, never the caller — see the rule in this
     * file's header. A refused entrant produces no metric at all; a vendor out
     * of credits produces this one, which is the distinction the entry gate
     * deliberately hides from the response and must not hide from the
     * operator (audit 2026-09-11, B-04).
     */
    geoSourceFailed: 'packet_geo_source_failed',
    /**
     * Counter: the composite fell through to a later source and got an answer.
     *
     * A gate running on its fallback looks perfectly healthy in the response.
     * This is the only place it is visible before the fallback fails too.
     */
    geoFellThrough: 'packet_geo_fell_through',
    /**
     * Counter (label `purpose`: preflight|issuance): OUR OWN ceiling refused
     * a lookup before the vendor saw it. `preflight` is the expected shape of
     * a traffic flood; `issuance` means the reserve is gone as well, and
     * entry has stopped.
     */
    geoBudgetRefused: 'packet_geo_budget_refused',
  },
  /**
   * Screening (`@blotto/sanctions`), emitted by BOTH services that screen —
   * the packet service at entry and the settlement daemon at resolving — so
   * every series here carries the `service` label that tells them apart.
   *
   * Nothing in this namespace is labelled with an address, a wallet or a
   * list name. Which wallet was refused is a durable record
   * (`sanctions_refusals`, migration 0019), not a metric dimension: the rule
   * at the top of this file about per-player labels applies with more force
   * to this table than to any other.
   */
  sanctions: {
    /**
     * Counter (label `outcome`: ok|failed): one OFAC mirror refresh attempt
     * finished. A `failed` that never returns to `ok` is the shape of the
     * staleness cliff approaching.
     */
    ofacRefresh: 'sanctions_ofac_refresh',
    /**
     * Gauge: how old the loaded mirror is, in hours. The alert thresholds
     * below are derived from it; the gauge is what a dashboard plots against
     * `SANCTIONS_OFAC_MAX_AGE_HOURS` so the approach is visible before an
     * alert fires.
     */
    ofacAgeHours: 'sanctions_ofac_age_hours',
    /** Counter: a boot-time mirror load attempt failed and will be retried. */
    ofacBootRetry: 'sanctions_ofac_boot_retry',
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
    /**
     * A recurring reconciliation walk threw. The service keeps serving — it is
     * a repair job, not the ingest path — but a reconciler that has been
     * failing silently is the state audit C-11 describes with extra steps.
     */
    reconcileFailed: 'indexer reconciliation walk failed',
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
  packet: {
    /**
     * A geo vendor's request allowance or rate limit is spent.
     *
     * Loud because it does not recover on its own — it needs a top-up — and
     * because the symptom is indistinguishable from a correctly refused
     * entrant from outside the service. Before 2026-09-12 the only trace was
     * a line on standard output.
     */
    geoQuotaSpent: 'packet geo vendor allowance spent',
    /** A geo vendor refused the credential. Never self-heals; needs a new key. */
    geoCredentialRefused: 'packet geo vendor credential refused',
    /**
     * EVERY geo source failed, so the gate has no answer and every entry is
     * being refused. The most serious operational state the entry path has.
     */
    geoAllSourcesFailed: 'packet geo all sources failed',
  },
  reveal: {
    /**
     * A reviewer's upheld forfeit is in the decision log but the on-chain
     * `forfeit_escrow` has not landed within the review window: the multisig
     * is late, the share sits in the vault, and the review clock is holding
     * its release on the log's word alone (audit 2026-09-11, D-03).
     */
    forfeitUnlanded: 'reveal forfeit logged but not landed on chain',
    /**
     * A Paid pool still has no published bundle after repeated attempts, so
     * nobody can verify it. Until 2026-09-12 a failed publish was never
     * retried at all (audit 2026-09-11, C-09 / B-32 / D-27).
     */
    bundleUnpublished: 'reveal settled pool still unpublished',
    /**
     * The crank scored an entry as all losses under the published
     * lost-ciphertext rule, so an entry-fee refund from the platform treasury
     * is OWED off-chain. The bundle records it; this is the only other place
     * it is said out loud (audit 2026-09-11, C-12).
     */
    entryRefundOwed: 'reveal entry refund owed after lost ciphertext',
    /**
     * No tick has completed within the staleness budget: the loop is wedged
     * on something that will not answer. /health turns 503 on the same
     * condition so the platform restarts the process (audit 2026-09-11,
     * C-22 / C-27).
     */
    tickStale: 'reveal daemon tick stale',
    /**
     * A detection run recommends that a human look at one or more entries
     * before the review window closes (ruling D-E9, 2026-09-12). Detection is
     * MANUAL: nothing acts on this by itself, which is exactly why a person
     * reading the report is the whole control. The report is persisted either
     * way; this is what makes someone read it.
     */
    detectionReviewRecommended: 'reveal detection recommends human review',
    /**
     * A detection run could not be persisted. The pool still settles — a
     * store failure must never wedge settlement — but the report then exists
     * nowhere, which is the state audit A-18 describes.
     */
    detectionReportUnstored: 'reveal detection report not stored',
  },
  review: {
    /**
     * THE CHAIN ACTION LANDED AND THE DECISION LOG WRITE FAILED (audit
     * B-24). Irreversible work is done and the published record of it is
     * missing, so "every decision is published in a signed log" is untrue
     * for that entry until someone repairs it. The reviewer was told the
     * truth in the response; this is what tells the operator.
     */
    decisionNotLogged: 'review decision applied but not logged',
    /**
     * A forfeit is on the record and its on-chain instruction did not land
     * from here (audit C-07). Expected when the refusal is "this service
     * holds no admin key" — the operator lands it with `scripts/admin.ts
     * forfeit-escrow` — and NOT expected for any other reason, which is why
     * the refusal text rides along. The daemon's review clock holds the
     * release meanwhile and raises `forfeitUnlanded` if the window closes
     * with the chain still not carrying it.
     */
    forfeitNotLanded: 'review forfeit recorded but not landed from the service',
    /**
     * One reviewer key spent its whole action budget inside one window
     * (audit B-25). A person reviewing entries does not do this; a key being
     * scripted does. The refusal is the hard stop, this is the warning.
     */
    reviewerBudgetSpent: 'review reviewer action budget spent',
  },
  /**
   * Screening. The mirrored OFAC list REFUSES TO ANSWER past
   * `SANCTIONS_OFAC_MAX_AGE_HOURS` rather than say "not listed" from a stale
   * list (`ofac-sdn.ts`, property 1). In the staged production config it is
   * the only assured source, so that refusal stops entry and holds every
   * winner payment — and until 2026-09-12 the whole approach to it was
   * announced by one `console.warn` per failed refresh (audit 2026-09-11,
   * B-28).
   */
  sanctions: {
    /**
     * The mirror is approaching its staleness limit: refreshes have been
     * failing long enough that a transient blip is ruled out. Actionable
     * while there is still time to act — see `ofacStale` for what happens
     * when the limit passes.
     */
    ofacStaleSoon: 'sanctions ofac mirror approaching its staleness limit',
    /**
     * The mirror is PAST its limit and is now refusing every screening. With
     * no vendor beside it that is the entry gate closed and every settlement
     * held. Re-raised on every check while it lasts, because it does not
     * recover without either a reachable Treasury host or an operator.
     */
    ofacStale: 'sanctions ofac mirror past its staleness limit',
    /**
     * The boot-time load exhausted its retries. Either the service refused
     * to start (the mirror was the only source) or it started screening on
     * the vendors alone with the fallback absent — the message says which.
     */
    ofacBootFailed: 'sanctions ofac mirror could not load at boot',
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
