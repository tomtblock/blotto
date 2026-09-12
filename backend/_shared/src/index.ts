/**
 * Public surface of `@blotto/backend-shared`.
 *
 * Carried from the predecessor repository. The exports are the plumbing the
 * sealing store and the detection pipeline will need — environment and config
 * loading, the Postgres block, HTTP hygiene for any public endpoint, and the
 * metrics/alert seam — plus the generic half of the Anchor event decoder.
 *
 * NOT carried, and deliberately absent: that product's progression maths, its wallet
 * account decoding, and its per-event decoders. See EXTRACTION-REPORT.md.
 */

export {
  parseBool,
  required,
  optional,
  parsePositiveInt,
  loadPostgresConfig,
  DEFAULT_DATABASE_URL,
  POSTGRES_ENV,
  type PostgresConfig,
} from './config';

export {
  LoggingMonitor,
  SILENT_MONITOR,
  consoleLogger,
  loadMonitor,
  buildMonitor,
  MONITOR_SINK_ENV,
  type Monitor,
  type Labels,
  type Logger,
  type MonitorSink,
  type MonitorConfig,
  type BuildMonitorOptions,
} from './monitor';

export {
  PrometheusMonitor,
  serveMetricsIfPrometheus,
  createMetricsServer,
  ALERTS_TOTAL,
  type PrometheusMonitorOptions,
  type HttpPost,
} from './prometheus';

export { METRIC, ALERT, NEVER_ALERT_METRICS, isAlertableMetric } from './metrics';

export {
  anchorEventDiscriminator,
  extractProgramData,
  decodeAnchorEvent,
  decodeProgramData,
  decodeEventsFromLogs,
  eventToJson,
  eventFromJson,
  registerEventLayout,
  registeredEventNames,
  clearEventLayouts,
  type DecodedEvent,
  type IndexedEvent,
  type EventLayout,
  type UndecodableObserver,
} from './events';

export { createPool, withTransaction, type Queryable } from './db';

export {
  RateLimiter,
  startBucketSweeper,
  BUCKET_SWEEP_INTERVAL_MS,
  BUCKET_IDLE_EVICT_MS,
  applyHygiene,
  clientKeyFrom,
  corsHeadersFor,
  isPreflight,
  securityHeaders,
  loadHygieneConfig,
  HYGIENE_ENV,
  RATE_LIMITED_BODY,
  PROPOSED_RATE_LIMIT_RPM,
  PROPOSED_RATE_LIMIT_BURST,
  PROPOSED_RATE_LIMIT_RETRY_AFTER_SECONDS,
  type RateLimitConfig,
  type RateLimitDecision,
  type BucketSweeper,
  type CorsConfig,
  type HygieneConfig,
  type HygieneRequest,
  type HygieneOutcome,
  type MonotonicClock,
} from './http-hygiene';

export { registerBlottoEventLayouts, base58Encode, base58Decode } from './blotto-events';
