/**
 * `PrometheusMonitor` — the production metrics sink (Phase 9 Step 6, T2).
 *
 * Accumulates counters and gauges in memory and serves them in Prometheus text-exposition format
 * on a `GET /metrics` route. The shipping model is text-endpoint + a single Grafana Alloy agent
 * that scrapes every daemon and `remote_write`s to Grafana Cloud (see `backend/monitoring/`), so
 * this sink is a DEPENDENCY-LIGHT TEXT EMITTER: zero external SDK, pure Node + the `Monitor`
 * interface. All cloud credentials and network egress live in Alloy, never here.
 *
 * Isolation (Step 6 hard constraint): this lives in its own file and imports `monitor.ts` ONLY for
 * types (erased at compile time), so there is no runtime import cycle and the monitor-only
 * re-export path (me-registration) stays `pg`-free. The only runtime imports are Node built-ins.
 *
 * `alert()` does three things: (1) increments an `blotto_alerts_total{reason}` counter so a
 * backend evaluator (Grafana Alerting) can page on it, (2) writes the loud log line so nothing is
 * silent, and (3) if a Discord webhook URL is configured, posts the alert directly — for the few
 * app-level signals a scrape cannot see in time (e.g. the gated-but-fired informational alert).
 */

import { request as httpsRequest } from 'https';
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'http';
import type { Labels, Logger, Monitor } from './monitor';

/** Counter name the alert channel feeds, so Grafana can page on `increase(...)` of a reason. */
export const ALERTS_TOTAL = 'blotto_alerts_total';

/** Fire-and-forget HTTP POST seam (injected in tests so the suite stays offline). */
export type HttpPost = (url: string, jsonBody: string) => void;

export interface PrometheusMonitorOptions {
  /** Attached as the `service` label on every series (injected by `buildMonitor`). */
  serviceLabel?: string;
  /** Loud-channel logger; defaults to a plain console logger. */
  logger?: Logger;
  /** Optional Discord/Slack webhook — when set, `alert()` posts to it directly (SEV-2 / info). */
  discordWebhookUrl?: string;
  /** Override the POST implementation (tests inject a recorder; default uses Node `https`). */
  post?: HttpPost;
}

type MetricType = 'counter' | 'gauge';

interface Series {
  name: string;
  type: MetricType;
  labels: Labels;
  value: number;
}

const DEFAULT_LOGGER: Logger = {
  info: (m: string) => console.log(m),
  error: (m: string) => console.error(m),
};

/**
 * Default Discord poster — a single fire-and-forget POST over Node's built-in `https`/`http`.
 * Never throws (alert() must not fail the caller) and never logs the payload anywhere sensitive.
 */
function defaultPost(url: string, jsonBody: string): void {
  try {
    const u = new URL(url);
    const req = (u.protocol === 'http:' ? httpRequest : httpsRequest)(
      {
        method: 'POST',
        hostname: u.hostname,
        port: u.port || undefined,
        path: u.pathname + u.search,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(jsonBody),
        },
      },
      (res) => {
        // Drain so the socket frees; the response body is irrelevant.
        res.on('data', () => undefined);
        res.on('end', () => undefined);
      }
    );
    req.on('error', () => undefined);
    req.write(jsonBody);
    req.end();
  } catch {
    // A malformed URL or sync throw must never crash the service.
  }
}

/** Escape a label value per the Prometheus text exposition format. */
function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/** Render a label set to the `{k="v",...}` suffix (sorted for stable series identity). */
function renderLabels(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) {
    return '';
  }
  const parts = keys.map((k) => `${k}="${escapeLabelValue(String(labels[k]))}"`);
  return `{${parts.join(',')}}`;
}

export class PrometheusMonitor implements Monitor {
  private readonly serviceLabel?: string;
  private readonly logger: Logger;
  private readonly discordWebhookUrl?: string;
  private readonly post: HttpPost;
  /** One entry per unique (name, label-set); the map key is the rendered series identity. */
  private readonly series = new Map<string, Series>();

  constructor(opts: PrometheusMonitorOptions = {}) {
    this.serviceLabel = opts.serviceLabel;
    this.logger = opts.logger ?? DEFAULT_LOGGER;
    this.discordWebhookUrl = opts.discordWebhookUrl;
    this.post = opts.post ?? defaultPost;
  }

  /** Merge the injected `service` label under any call-site labels (call-site wins on conflict). */
  private withService(labels?: Labels): Labels {
    return this.serviceLabel ? { service: this.serviceLabel, ...labels } : { ...labels };
  }

  private key(name: string, labels: Labels): string {
    return `${name}${renderLabels(labels)}`;
  }

  recordEvent(name: string, labels?: Labels): void {
    const merged = this.withService(labels);
    const k = this.key(name, merged);
    const existing = this.series.get(k);
    if (existing) {
      existing.value += 1;
    } else {
      this.series.set(k, { name, type: 'counter', labels: merged, value: 1 });
    }
  }

  reportGauge(name: string, value: number, labels?: Labels): void {
    const merged = this.withService(labels);
    const k = this.key(name, merged);
    this.series.set(k, { name, type: 'gauge', labels: merged, value });
  }

  alert(reason: string, detail: Record<string, unknown>): void {
    const merged = this.withService();
    // (1) surface as a counter so a backend evaluator can page on it.
    this.recordEvent(ALERTS_TOTAL, { ...merged, reason });
    // (2) the loud log line — nothing is silent even before Grafana is wired.
    this.logger.error(`[monitor][ALERT] ${reason} ${JSON.stringify({ ...merged, ...detail })}`);
    // (3) optional direct push for signals a scrape cannot see in time.
    if (this.discordWebhookUrl) {
      const content = `:rotating_light: **${reason}** ${JSON.stringify({ ...merged, ...detail })}`;
      this.post(this.discordWebhookUrl, JSON.stringify({ content }));
    }
  }

  /** Render the full registry in Prometheus text-exposition format (one `# TYPE` per metric). */
  exposition(): string {
    const byName = new Map<string, Series[]>();
    for (const s of this.series.values()) {
      const list = byName.get(s.name);
      if (list) {
        list.push(s);
      } else {
        byName.set(s.name, [s]);
      }
    }
    const lines: string[] = [];
    for (const name of [...byName.keys()].sort()) {
      const group = byName.get(name)!;
      lines.push(`# TYPE ${name} ${group[0].type}`);
      for (const s of group) {
        lines.push(`${name}${renderLabels(s.labels)} ${s.value}`);
      }
    }
    return lines.length ? lines.join('\n') + '\n' : '';
  }
}

/**
 * Serve `GET /metrics` from an existing Node `http` server when (and only when) the active sink is
 * a `PrometheusMonitor`. Returns `true` if it handled the request (the caller should stop), `false`
 * otherwise (the caller's normal routing continues — `/metrics` is simply not a route under the
 * logging/silent sinks). This lets any daemon bolt a `/metrics` route onto the
 * server they already run without each importing the sink internals.
 */
export function serveMetricsIfPrometheus(
  monitor: Monitor,
  req: IncomingMessage,
  res: ServerResponse
): boolean {
  if (!(monitor instanceof PrometheusMonitor)) {
    return false;
  }
  const path = (req.url ?? '/').split('?')[0];
  if (req.method !== 'GET' || path !== '/metrics') {
    return false;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
  res.end(monitor.exposition());
  return true;
}

/**
 * A standalone minimal `/metrics` listener for a service with no HTTP server of its own
 * (me-registration). Built-in `http`, no framework: every non-`/metrics` request is a bare 404.
 */
export function createMetricsServer(monitor: Monitor): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    if (serveMetricsIfPrometheus(monitor, req, res)) {
      return;
    }
    res.writeHead(404).end();
  });
}
