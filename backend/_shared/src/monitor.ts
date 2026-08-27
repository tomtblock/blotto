/**
 * `Monitor` — the shared metrics/alert sink for all off-chain services.
 *
 * This is the real seam behind TM-607. Phase 7 Step 4 shipped a `FallbackMonitor`
 * (in `services/me-registration/src/fallback.ts`) with a `LoggingMonitor` default,
 * deliberately leaving the production metrics/alerting sink for Phase 9. This
 * interface is that sink: a counter (`recordEvent`), a gauge (`reportGauge`), and
 * a loud, monitored `alert` channel — the three primitives `FallbackMonitor`'s
 * `recordSendAttempt` / `recordSendResult` / `reportBalance` / `alert` reduce to.
 *
 * Step 0 only DEFINES the interface and ships a logging-only default. Nothing is
 * wired: the swap of me-registration's `FallbackMonitor` onto a `Monitor`-backed
 * adapter happens in Step 5 (ME hardening), not here. Keeping the seam unwired but
 * named is the point — `alert()` exists so that, once wired, nothing fails silently
 * (a drained fallback key, a gated-but-fired send, an indexer stall) (TM-504, TM-607).
 */

import { PrometheusMonitor } from './prometheus';

/** Optional label set attached to a metric (e.g. `{ service: "indexer", event: "buy" }`). */
export type Labels = Record<string, string>;

export interface Monitor {
  /** Increment a named counter (an event happened). */
  recordEvent(name: string, labels?: Labels): void;
  /** Report the latest value of a named gauge (a level: balance, lag, queue depth). */
  reportGauge(name: string, value: number, labels?: Labels): void;
  /** Loud, monitored signal — something operationally wrong that a human must see. */
  alert(reason: string, detail: Record<string, unknown>): void;
}

/** Minimal logger contract (mirrors the existing services' `WatcherLogger` shape). */
export interface Logger {
  info(msg: string): void;
  error(msg: string): void;
}

/** The default logger — plain console. */
export const consoleLogger: Logger = {
  info: (msg: string) => console.log(msg),
  error: (msg: string) => console.error(msg),
};

/**
 * Default `Monitor` — routes every signal to the logger loudly. This is the
 * Phase 9 generalization of me-registration's `LoggingMonitor`; the real metrics
 * sink (`PrometheusMonitor`, Step 6) is selected at go-live via `buildMonitor`.
 *
 * Optionally injects a `service` label so a multi-service log stream is splittable
 * by source, exactly as the Prometheus sink does — `buildMonitor` passes it in.
 */
export class LoggingMonitor implements Monitor {
  private readonly logger: Logger;
  private readonly serviceLabel?: string;
  constructor(logger: Logger = consoleLogger, serviceLabel?: string) {
    this.logger = logger;
    this.serviceLabel = serviceLabel;
  }
  private withService(labels?: Labels): Labels {
    return this.serviceLabel ? { service: this.serviceLabel, ...labels } : { ...labels };
  }
  recordEvent(name: string, labels?: Labels): void {
    this.logger.info(`[monitor] event ${name}${fmt(this.withService(labels))}`);
  }
  reportGauge(name: string, value: number, labels?: Labels): void {
    this.logger.info(`[monitor] gauge ${name}=${value}${fmt(this.withService(labels))}`);
  }
  alert(reason: string, detail: Record<string, unknown>): void {
    this.logger.error(
      `[monitor][ALERT] ${reason} ${JSON.stringify({ ...this.withService(), ...detail })}`
    );
  }
}

/** Silent monitor — for tests that don't assert on monitoring. */
export const SILENT_MONITOR: Monitor = {
  recordEvent: () => undefined,
  reportGauge: () => undefined,
  alert: () => undefined,
};

function fmt(labels?: Labels): string {
  if (!labels || Object.keys(labels).length === 0) {
    return '';
  }
  return ' ' + JSON.stringify(labels);
}

// --- Sink selection (Step 6, T1) --------------------------------------------------------------

/**
 * Which `Monitor` sink a service routes to. ONE selector across all services (generalizes
 * me-registration's `ME_REG_MONITOR_SINK`):
 *   - `logging`    — loud to the logger; the DEFAULT, so offline suites are network-free.
 *   - `silent`     — no-op; ephemeral runs / tests that don't assert on monitoring.
 *   - `prometheus` — accumulate + serve `/metrics` for an Alloy scrape (go-live, no SDK).
 */
export type MonitorSink = 'logging' | 'silent' | 'prometheus';

/** The single env var that selects the sink for every service. */
export const MONITOR_SINK_ENV = 'BLOTTO_MONITOR_SINK';

export interface MonitorConfig {
  sink: MonitorSink;
}

/** Options passed through to the constructed sink (logger, Discord push for the Prometheus sink). */
export interface BuildMonitorOptions {
  logger?: Logger;
  /** Optional Discord/Slack webhook for the Prometheus sink's direct `alert()` push. */
  discordWebhookUrl?: string;
}

/** Parse + validate the sink selector from the environment. Defaults to `logging` (network-free). */
export function loadMonitor(env: NodeJS.ProcessEnv = process.env): MonitorConfig {
  const raw = env[MONITOR_SINK_ENV]?.trim().toLowerCase();
  if (raw === undefined || raw === '') {
    return { sink: 'logging' };
  }
  if (raw === 'logging' || raw === 'silent' || raw === 'prometheus') {
    return { sink: raw };
  }
  throw new Error(
    `${MONITOR_SINK_ENV} must be one of "logging" | "silent" | "prometheus"; got "${env[MONITOR_SINK_ENV]}"`
  );
}

/**
 * Build the selected sink, tagging every metric with `serviceLabel` so a multi-service sink can
 * split by source. The returned instance is the concrete sink (not a wrapper), so callers can
 * `instanceof PrometheusMonitor` to mount a `/metrics` route (see `serveMetricsIfPrometheus`).
 *
 * The `PrometheusMonitor` import is the only runtime edge to `prometheus.ts`; that module imports
 * THIS one for types only, so there is no runtime cycle and the import is `pg`-free.
 */
export function buildMonitor(
  config: MonitorConfig,
  serviceLabel: string,
  opts: BuildMonitorOptions = {}
): Monitor {
  switch (config.sink) {
    case 'silent':
      return SILENT_MONITOR;
    case 'prometheus':
      // Static import is cycle-free: `prometheus.ts` imports THIS module for types only.
      return new PrometheusMonitor({
        serviceLabel,
        logger: opts.logger ?? consoleLogger,
        discordWebhookUrl: opts.discordWebhookUrl,
      });
    case 'logging':
    default:
      return new LoggingMonitor(opts.logger ?? consoleLogger, serviceLabel);
  }
}
