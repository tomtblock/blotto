/**
 * The IPLocate geo adapter (R2's vendor of record).
 *
 * Contract verified against the live API on 2026-08-31, not from memory:
 *
 *   GET https://iplocate.io/api/lookup/<ip>      — PATH style, not ?ip=
 *   X-API-Key: <key>                             — a bad key answers 401
 *   -> { country_code: "GB", subdivision: "England",
 *        privacy: { is_vpn, is_proxy, is_tor, is_anonymous, ... }, ... }
 *
 * Four decisions in here are load-bearing.
 *
 * 1. THIS ADAPTER RESOLVES NO REGION, AND NOW SAYS SO IN THE TYPE.
 *    IPLocate's `subdivision` is a NAME ("England", "California"), and no
 *    subdivision CODE field exists. `territoryAllowed` treats any region that
 *    is not one to three upper-case alphanumerics as ambiguous and blocks it
 *    — so forwarding `subdivision` would fail-close on every single lookup
 *    and block the entire world. Country-level only, which is exactly what
 *    `config/territories.json` carries today.
 *
 *    Until 2026-09-12 that was recorded in prose here and in
 *    TRANSITION-REPORT.md's accepted gap, and nothing in the code enforced
 *    it: a `"US-NY"` line could be added to the schedule and would admit
 *    every person it named, silently, because the region never arrives
 *    (audit 2026-09-11, C-30). `resolvesRegion = false` is that prose made
 *    mechanical — `assertRegionCapability` (service.ts) refuses to start a
 *    service whose schedule carries a sub-national rule this adapter cannot
 *    enforce, which is the boot assertion TRANSITION-REPORT.md asked for,
 *    and `issuePacket` refuses the individual entry as a second line. A
 *    future adapter that does return ISO 3166-2 codes declares
 *    `resolvesRegion = true` and both checks pass.
 *
 * 2. A 429 IS NEVER RETRIED. The free plan is a DAILY request cap over a
 *    finite, non-renewing credit balance. Retrying an exhausted quota does
 *    not recover it, it spends the reserve — so quota exhaustion fails fast
 *    and loudly, and only transient faults (network, 5xx) are retried.
 *
 * 3. `is_hosting` IS NOT TREATED AS A VPN. Datacentre origin is not
 *    anonymisation, and the rehearsal's own entrants may run from one.
 *    Whether to block hosting providers at launch is a founder call
 *    (detection policy), recorded as an open item rather than assumed here.
 *
 * 4. THE DEADLINE COVERS THE BODY, NOT ONLY THE HEAD (audit 2026-09-11,
 *    G-07 — the same defect as the sanctions vendors' `withRetry`). The
 *    timer used to be cleared the moment the response head arrived, leaving
 *    `res.json()` unbounded: a vendor that answers 200 and then stops
 *    sending hung the entry gate with nothing failed and nothing logged.
 *    One `AbortSignal.timeout` per attempt now stays live until the body is
 *    parsed.
 *
 * ACCEPTED LIMITATION, recorded where the code that has it lives (audit
 * 2026-09-11, B-43): screening is IP-only and per-request. The address the
 * lookup sees is the one that reached our edge, so a VPN or proxy the vendor
 * has not catalogued defeats it, and nothing binds the screened address to
 * the wallet that later enters. That is the limit of IP geolocation as a
 * category, not a gap in this adapter: the remedies are a second signal
 * (device or payment) or an identity check, both of which are founder-owned
 * product decisions (D-B4 keeps identity to a clickwrap). `privacy.is_vpn`
 * and its siblings are what the vendor can tell us and all of what it can.
 *
 * Every failure path throws. The packet service catches, logs the reason
 * server-side, and answers with the one generic rejection — which is what
 * makes the whole geo path fail-closed.
 */

import type { GeoLookup, GeoLookupResult } from './service';

/** Quota exhausted or rate-limited. Separated because the operator response
 * is "stop and wait", never "debug the territory gate" — and because on a
 * daily cap it will otherwise look exactly like a blocked entrant. */
export class GeoQuotaError extends Error {
  constructor(status: number) {
    super(
      `geo vendor: QUOTA OR RATE LIMIT (HTTP ${status}) — the daily request cap is spent. ` +
        `Every entry is now refused until it resets. This is NOT a territory block.`
    );
    this.name = 'GeoQuotaError';
  }
}

/** The credential was refused. Distinct from quota: it never recovers on its own. */
export class GeoAuthError extends Error {
  constructor(status: number) {
    super(`geo vendor: CREDENTIAL REFUSED (HTTP ${status}) — check GEO_VENDOR_API_KEY.`);
    this.name = 'GeoAuthError';
  }
}

export interface IpLocateOptions {
  /** Base URL without a trailing slash or ip, e.g. https://iplocate.io/api/lookup */
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** Attempts for TRANSIENT faults only. 1 = no retry. */
  attempts?: number;
  /** First backoff step in ms; doubles per attempt, with jitter. */
  backoffMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface IpLocateBody {
  country_code?: unknown;
  privacy?: {
    is_vpn?: unknown;
    is_proxy?: unknown;
    is_tor?: unknown;
    is_anonymous?: unknown;
  };
}

const DEFAULTS = { attempts: 3, backoffMs: 250, timeoutMs: 4000 };

export class IpLocateGeoLookup implements GeoLookup {
  private readonly o: Required<IpLocateOptions>;

  /**
   * Decision 1: this vendor answers with a subdivision NAME, never a code,
   * so no sub-national rule can be enforced through it. Declared rather than
   * described, so `assertRegionCapability` can refuse a schedule that
   * assumes otherwise.
   */
  readonly resolvesRegion = false;

  constructor(options: IpLocateOptions) {
    this.o = {
      fetchImpl: fetch,
      attempts: DEFAULTS.attempts,
      backoffMs: DEFAULTS.backoffMs,
      timeoutMs: DEFAULTS.timeoutMs,
      sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
      ...options,
      baseUrl: options.baseUrl.replace(/\/+$/, ''),
    };
    if (!this.o.apiKey) throw new Error('IpLocateGeoLookup: apiKey is required');
  }

  async lookup(ip: string): Promise<GeoLookupResult> {
    let lastTransient: Error | undefined;

    for (let attempt = 1; attempt <= this.o.attempts; attempt++) {
      let res: Response;
      // Decision 4: one deadline per attempt, live until the body is parsed.
      const signal = AbortSignal.timeout(this.o.timeoutMs);
      try {
        res = await this.o.fetchImpl(`${this.o.baseUrl}/${encodeURIComponent(ip)}`, {
          headers: { 'X-API-Key': this.o.apiKey },
          signal,
        });
      } catch (e) {
        // Network fault or timeout — transient, worth another attempt.
        lastTransient = this.faultFor(signal, 'awaiting the response head', e);
        if (attempt < this.o.attempts) {
          await this.o.sleep(this.backoffFor(attempt));
          continue;
        }
        throw new Error(`geo vendor: unreachable after ${attempt} attempts — ${lastTransient.message}`);
      }

      // Terminal statuses: retrying spends credits and cannot help.
      if (res.status === 429) throw new GeoQuotaError(res.status);
      if (res.status === 401 || res.status === 403) throw new GeoAuthError(res.status);

      if (res.status >= 500) {
        lastTransient = new Error(`geo vendor: HTTP ${res.status}`);
        if (attempt < this.o.attempts) {
          await this.o.sleep(this.backoffFor(attempt));
          continue;
        }
        throw lastTransient;
      }

      if (!res.ok) throw new Error(`geo vendor: HTTP ${res.status}`);
      try {
        return this.map(await res.json());
      } catch (e) {
        // A stalled or truncated body — the head arrived, so no branch above
        // saw a fault. A malformed-but-complete body is NOT transient and is
        // rethrown as it was raised by `map`.
        if (!signal.aborted) throw e;
        lastTransient = this.faultFor(signal, 'reading the response body', e);
        if (attempt < this.o.attempts) {
          await this.o.sleep(this.backoffFor(attempt));
          continue;
        }
        throw new Error(
          `geo vendor: no readable answer after ${attempt} attempts — ${lastTransient.message}`
        );
      }
    }

    /* istanbul ignore next — the loop always returns or throws. */
    throw lastTransient ?? new Error('geo vendor: no answer');
  }

  private backoffFor(attempt: number): number {
    // Exponential with full jitter, so 64 concurrent entrants that all meet
    // the same blip do not retry in lockstep and amplify it.
    const ceiling = this.o.backoffMs * 2 ** (attempt - 1);
    return Math.floor(Math.random() * ceiling);
  }

  /** Name a fault OUR deadline caused; report anything else as it arrived. */
  private faultFor(signal: AbortSignal, phase: string, cause: unknown): Error {
    if (signal.aborted) {
      return new Error(`geo vendor: timed out after ${this.o.timeoutMs}ms ${phase}`);
    }
    return cause instanceof Error ? cause : new Error(String(cause));
  }

  private map(raw: unknown): GeoLookupResult {
    const body = (raw ?? {}) as IpLocateBody;
    const country = body.country_code;
    if (typeof country !== 'string' || !/^[A-Za-z]{2}$/.test(country)) {
      throw new Error('geo vendor: no usable country_code in the answer');
    }
    const p = body.privacy ?? {};
    return {
      country: country.toUpperCase(),
      // Deliberately absent — see decision 1 in this file's header.
      region: undefined,
      vpnOrProxy:
        p.is_vpn === true || p.is_proxy === true || p.is_tor === true || p.is_anonymous === true,
    };
  }
}
