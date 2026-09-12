/**
 * Several geo sources, one answer — and the failure signal the entry gate
 * never had.
 *
 * WHY THIS EXISTS. Until 2026-09-12 the geo path was a single paid vendor on
 * a finite, non-renewing credit balance, reached through an unauthenticated
 * route that spends one credit per unseen client address. When the balance
 * ran out the vendor answered 429, the adapter (correctly) refused to retry,
 * `geoVerdict` returned false and `issuePacket`'s catch returned the generic
 * rejection — so EVERY entry was refused, for the rest of the day, and the
 * only trace was a line on standard output. The audit of 2026-09-11 rated it
 * a total, silent denial of the one journey that takes money (B-04).
 *
 * Two things were wrong and both are fixed here.
 *
 * 1. ONE SOURCE. A vendor out of credits, locked out, or simply down took the
 *    whole gate with it. This composite asks its sources IN ORDER and the
 *    first one that answers decides; a source that throws is recorded and the
 *    next is asked. Only when every source has failed does the composite
 *    throw, and then the call site's own fail-closed rule applies as before.
 *
 * 2. SILENCE. Every source failure now raises a monitor event with a bounded
 *    reason, and quota and credential failures additionally raise a loud
 *    alert, because they are the two that do not fix themselves: a spent
 *    balance needs a top-up and a refused key needs a new key. Neither is
 *    visible from the response, by design, so it has to be visible here.
 *
 * HOW THIS DIFFERS FROM THE SANCTIONS COMPOSITE, deliberately.
 * `backend/sanctions/src/composite.ts` asks every source concurrently and ORs
 * the verdicts, because a cross-check may ADD a match and must never remove
 * one. Geolocation is not like that: the sources answer the same question
 * about the same address, each answer costs money, and a second opinion
 * cannot make an address "more" in a country. So this one is sequential and
 * stops at the first answer — cheapest first, fallback behind it.
 *
 * WHAT IS NOT FIXED HERE. Which vendor sits in the second slot is a founder
 * call (R2 names the vendor of record). This module ships the seam and the
 * signal; with a single source configured, a fall-through has nowhere to go
 * and the availability exposure is reduced but not removed. `main.ts` says so
 * at startup rather than leaving the operator to infer it.
 */

import { ALERT, METRIC } from '../../_shared/src/metrics';
import type { Monitor } from '../../_shared/src/monitor';
import { GeoAuthError, GeoQuotaError } from './geo-iplocate';
import { GeoBudgetSpentError } from './geo-budget';
import type { GeoLookup, GeoLookupResult } from './service';

/**
 * Why a source could not answer, as a BOUNDED metric label.
 *
 * Bounded is the point: `metrics.ts` keeps high-cardinality detail out of
 * labels, and this is four values whatever the vendor writes in its message.
 *
 *   `quota`      — the balance or rate limit is spent. Needs a top-up.
 *   `credential` — the key was refused. Needs a new key; never self-heals.
 *   `budget`     — OUR OWN ceiling stopped the call before the vendor saw it
 *                  (see `geo-budget.ts`); no credit was spent.
 *   `fault`      — anything else: unreachable, timed out, 5xx, unreadable body.
 */
export type GeoFailureKind = 'quota' | 'credential' | 'budget' | 'fault';

export function classifyGeoFailure(e: unknown): GeoFailureKind {
  if (e instanceof GeoQuotaError) return 'quota';
  if (e instanceof GeoAuthError) return 'credential';
  if (e instanceof GeoBudgetSpentError) return 'budget';
  return 'fault';
}

/** Every configured source failed, so there is no answer to give. */
export class GeoUnavailableError extends Error {
  constructor(
    readonly failed: readonly string[],
    readonly causes: readonly Error[]
  ) {
    super(
      `geo: no source could answer — ${failed
        .map((name, i) => `${name}: ${causes[i]?.message ?? 'unknown'}`)
        .join(' | ')}`
    );
    this.name = 'GeoUnavailableError';
  }
}

export interface NamedGeoSource {
  /** Short, stable name for logs and alert detail — never a metric label. */
  readonly name: string;
  readonly lookup: GeoLookup;
}

export class CompositeGeoLookup implements GeoLookup {
  constructor(
    private readonly sources: readonly NamedGeoSource[],
    private readonly monitor: Monitor
  ) {
    if (sources.length === 0) throw new Error('CompositeGeoLookup: no sources');
  }

  /** How many sources stand behind this lookup — startup logging reads it. */
  get depth(): number {
    return this.sources.length;
  }

  async lookup(ip: string): Promise<GeoLookupResult> {
    const failed: string[] = [];
    const causes: Error[] = [];

    for (const source of this.sources) {
      try {
        const answer = await source.lookup.lookup(ip);
        if (failed.length > 0) {
          // Worth its own counter: a gate running on its fallback is healthy
          // in the response and unhealthy underneath, which is exactly the
          // state that goes unnoticed until the fallback fails too.
          this.monitor.recordEvent(METRIC.packet.geoFellThrough);
        }
        return answer;
      } catch (e) {
        const cause = e instanceof Error ? e : new Error(String(e));
        const reason = classifyGeoFailure(e);
        failed.push(source.name);
        causes.push(cause);
        this.monitor.recordEvent(METRIC.packet.geoSourceFailed, { reason });
        // Quota and credential do not recover on their own, so they page.
        // A transient fault does not — that is what the counter is for.
        if (reason === 'quota' || reason === 'credential') {
          this.monitor.alert(
            reason === 'quota' ? ALERT.packet.geoQuotaSpent : ALERT.packet.geoCredentialRefused,
            { source: source.name, detail: cause.message }
          );
        }
        console.error(`packet: geo source '${source.name}' failed (${reason}) — ${cause.message}`);
      }
    }

    // Nothing answered. The callers already fail closed on a throw; this
    // alert is so that the operator learns it from a page rather than from a
    // founder asking why nobody can enter.
    this.monitor.alert(ALERT.packet.geoAllSourcesFailed, {
      sources: failed,
      detail: causes.map((c) => c.message),
    });
    throw new GeoUnavailableError(failed, causes);
  }
}
