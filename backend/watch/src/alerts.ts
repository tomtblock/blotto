/*
 * The services' own alerts, read from their private metrics.
 *
 * Every service already raises named alerts (`ALERT` in
 * `backend/_shared/src/metrics.ts`) — "settled pool still unpublished",
 * "entry refund owed after lost ciphertext", "geo vendor allowance spent" —
 * and until R23 each one was a log line and a counter that nothing read. The
 * watcher reads the counter, `blotto_alerts_total{reason,service}`, from each
 * app's private listener (`http://<app>.internal:9090/metrics`) and turns an
 * increase into an incident.
 *
 * A Prometheus counter only appears once it has been incremented, so a reason
 * that shows up between two scrapes went from 0 to n: that is an increase. A
 * counter that goes DOWN means the service restarted; the new value becomes
 * the baseline and nothing is raised.
 */

import { ALERT } from '../../_shared/src/metrics';
import type { CheckResult, Severity } from './checks';

/** `name{label="value",…} 12` → the alert reasons and their counts. */
export function parseAlertCounters(exposition: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of exposition.split('\n')) {
    if (!line.startsWith('blotto_alerts_total{')) continue;
    const close = line.lastIndexOf('}');
    if (close < 0) continue;
    const labels = line.slice('blotto_alerts_total{'.length, close);
    const value = Number(line.slice(close + 1).trim());
    if (!Number.isFinite(value)) continue;
    const reason = /(?:^|,)reason="((?:[^"\\]|\\.)*)"/.exec(labels);
    if (!reason) continue;
    const key = reason[1].replace(/\\(.)/g, '$1');
    out.set(key, (out.get(key) ?? 0) + value);
  }
  return out;
}

/** Alerts that mean players are affected now. Everything else is a warning. */
const CRITICAL_REASONS = new Set<string>([
  ALERT.reveal.forfeitUnlanded,
  ALERT.reveal.bundleUnpublished,
  ALERT.reveal.entryRefundOwed,
  ALERT.packet.geoQuotaSpent,
  ALERT.packet.geoCredentialRefused,
  ALERT.packet.geoAllSourcesFailed,
  ALERT.review.forfeitNotLanded,
  ALERT.sanctions.ofacStale,
  ALERT.sanctions.ofacBootFailed,
]);

export const alertSeverity = (reason: string): Severity =>
  CRITICAL_REASONS.has(reason) ? 'critical' : 'warning';

interface ReasonState {
  count: number;
  lastIncreaseMs: number | null;
}

export class AlertCounterTracker {
  /** app → reason → state. An app absent here has never been scraped. */
  private readonly seen = new Map<string, Map<string, ReasonState>>();

  constructor(
    private readonly quietMsToClear: number,
    private readonly ignore: ReadonlySet<string>
  ) {}

  /**
   * One scrape of one app. `exposition` null = the scrape failed; that app's
   * reasons read unknown (an unreachable counter clears nothing).
   */
  observe(app: string, exposition: string | null, nowMs: number): CheckResult[] {
    const known = this.seen.get(app);
    if (exposition === null) {
      return [...(known?.keys() ?? [])].map((reason) => this.result(app, reason, 'unknown', ''));
    }
    const counts = parseAlertCounters(exposition);
    const firstScrape = known === undefined;
    const state = known ?? new Map<string, ReasonState>();
    this.seen.set(app, state);

    const out: CheckResult[] = [];
    const reasons = new Set([...state.keys(), ...counts.keys()]);
    for (const reason of reasons) {
      if (this.ignore.has(reason)) continue;
      const now = counts.get(reason) ?? 0;
      const prev = state.get(reason);
      let lastIncreaseMs = prev?.lastIncreaseMs ?? null;
      if (prev === undefined) {
        // New since the last scrape: an increase from zero — unless this is
        // the first time this app has been read at all (a baseline).
        if (!firstScrape && now > 0) lastIncreaseMs = nowMs;
      } else if (now > prev.count) {
        lastIncreaseMs = nowMs;
      }
      // now < prev.count: the service restarted; re-baseline silently.
      state.set(reason, { count: now, lastIncreaseMs });
      const firing = lastIncreaseMs !== null && nowMs - lastIncreaseMs < this.quietMsToClear;
      out.push(
        this.result(
          app,
          reason,
          firing ? 'fail' : 'pass',
          firing ? `raised again within the last ${Math.round(this.quietMsToClear / 60_000)} min (count ${now})` : `quiet (count ${now})`
        )
      );
    }
    return out;
  }

  private result(app: string, reason: string, status: CheckResult['status'], detail: string): CheckResult {
    return {
      key: `alerts:${app}:${reason}`,
      status,
      title: `${app} raised "${reason}"`,
      detail,
      severity: alertSeverity(reason),
      failuresToOpen: 1,
      passesToClear: 1,
    };
  }
}

/** A service whose private metrics cannot be read: its own alerts are invisible. */
export function metricsReachResult(app: string, error: string | null, failuresToOpen: number): CheckResult {
  const base = {
    key: `watch:metrics:${app}`,
    title: `The watcher can't read ${app}'s alerts`,
    severity: 'warning' as Severity,
    failuresToOpen,
  };
  return error === null
    ? { ...base, status: 'pass', detail: 'metrics readable' }
    : { ...base, status: 'fail', detail: error };
}
