/**
 * The private `/metrics` listener (audit 2026-09-11, E-09 / A-19).
 *
 * THE DEFECT. The Prometheus sink, `createMetricsServer` and
 * `serveMetricsIfPrometheus` have all existed and been tested since Step 6,
 * and not one of them was reachable in a deployment: no environment selected
 * the sink, and nothing called either server helper. So every alert in the
 * system was a single line on standard output, and `/metrics` was not a route
 * on any service.
 *
 * WHY A SEPARATE LISTENER, and not a route on the service's own server. Each
 * of these services publishes exactly one port through the platform's router
 * (Fly's `internal_port`), and everything else it binds is reachable only
 * over the private network the machines share. A metrics endpoint belongs
 * there: the exposition names every alert reason and every counter this
 * system keeps, which is an operational map we have no reason to publish.
 * Mounting it on the public listener instead would have put that map on the
 * internet the moment the sink was selected.
 *
 * Nothing here is lost when the sink is `logging`: this returns null and
 * binds nothing, and `alert()` writes its loud line either way. The
 * Prometheus sink ADDS the `blotto_alerts_total{reason}` counter and the
 * exposition; it removes no logging.
 */

import type { Server } from 'http';
import { createMetricsServer } from './prometheus';
import type { Monitor } from './monitor';
import { portEnv } from './env-number';

/** The port every service exposes metrics on, over the private network only. */
export const METRICS_PORT_ENV = 'BLOTTO_METRICS_PORT';
export const DEFAULT_METRICS_PORT = 9090;

export interface MetricsListenerOptions {
  /** Where the one-line report goes. Injected in tests. */
  log?: (line: string) => void;
}

/**
 * Start the metrics listener if, and only if, the built monitor is the
 * Prometheus sink. Returns the server so a caller with a lifecycle can close
 * it; the services themselves run until the process ends.
 *
 * Returns null for every other sink, which is the ordinary case in
 * development and in any deployment that has not selected Prometheus.
 */
export function startMetricsListener(
  monitor: Monitor,
  service: string,
  env: NodeJS.ProcessEnv = process.env,
  opts: MetricsListenerOptions = {}
): Server | null {
  const log = opts.log ?? ((line: string) => console.log(line));

  // `createMetricsServer` answers 404 to everything when the monitor is not
  // the Prometheus sink, so asking it first would bind a port that serves
  // nothing. Probe the same way `serveMetricsIfPrometheus` does instead: a
  // sink that cannot produce an exposition has no listener at all.
  const server = createMetricsServer(monitor);
  if (!canExpose(monitor)) {
    // Built and discarded rather than never built: `createMetricsServer` does
    // not listen until told to, so nothing is bound and nothing leaks.
    log(`${service}: metrics sink is not prometheus — no /metrics listener`);
    return null;
  }

  const port = portEnv(env, METRICS_PORT_ENV, DEFAULT_METRICS_PORT);
  server.listen(port, () => {
    log(
      `${service}: /metrics on :${port} (private network only — not the platform's routed port)`
    );
  });
  // A metrics listener must never be the reason a process stays alive: a
  // service whose only remaining work is reporting on itself should exit.
  server.unref();
  return server;
}

/**
 * Whether this monitor can produce a Prometheus exposition.
 *
 * Asked by behaviour rather than by `instanceof`, so a future sink that
 * exposes the same surface is served without this module having to know its
 * type — and so this module does not need a runtime edge to `prometheus.ts`'s
 * class for the test alone.
 */
function canExpose(monitor: Monitor): boolean {
  return typeof (monitor as { exposition?: unknown }).exposition === 'function';
}
