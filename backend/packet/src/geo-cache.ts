/**
 * A short-lived, bounded, per-IP cache in front of any `GeoLookup`.
 *
 * WHY IT DOES NOT WEAKEN THE GATE. The territory decision is a pure function
 * of the address: `decide(country, region)` plus the VPN flag, all derived
 * from the IP and nothing else. Two requests from one IP already receive the
 * same verdict today — the cache does not change any answer, it only avoids
 * asking the vendor a question whose answer it already has. The security
 * model is per-IP either way.
 *
 * Three properties keep that true, and all three are tested:
 *
 *   1. A FAILURE IS NEVER CACHED. Not a throw, not a quota error, not a
 *      timeout. Caching a failure would either persist a refusal past its
 *      cause or — far worse — create a path where an unavailable vendor
 *      produces a stored answer. Only a successful vendor response is kept.
 *   2. THE KEY IS THE IP ITSELF, never a session, wallet or cookie. Keying
 *      on anything the caller controls would let a verdict be carried from
 *      one address to another, which WOULD weaken the gate.
 *   3. A SHORT TTL, so a genuine reclassification is picked up within
 *      minutes rather than persisting for the run.
 *
 * It exists because the plan's request budget is real: two lookups per
 * entrant across 64 entrants is 128 per pool against a 1,000/day cap over a
 * finite, non-renewing credit balance.
 */

import type { GeoLookup, GeoLookupResult } from './service';

interface Entry {
  value: GeoLookupResult;
  expiresAt: number;
}

export interface GeoCacheOptions {
  ttlMs?: number;
  /** Bound on distinct addresses held, so a long run cannot grow without limit. */
  maxEntries?: number;
  now?: () => number;
}

export class CachingGeoLookup implements GeoLookup {
  private readonly entries = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  /** Counters for the startup/health line — how much quota this actually saved. */
  hits = 0;
  misses = 0;

  constructor(
    private readonly inner: GeoLookup,
    options: GeoCacheOptions = {}
  ) {
    this.ttlMs = options.ttlMs ?? 15 * 60 * 1000;
    this.maxEntries = options.maxEntries ?? 4096;
    this.now = options.now ?? Date.now;
  }

  async lookup(ip: string): Promise<GeoLookupResult> {
    const hit = this.entries.get(ip);
    if (hit && hit.expiresAt > this.now()) {
      this.hits++;
      return hit.value;
    }
    if (hit) this.entries.delete(ip);

    // A throw propagates untouched and stores NOTHING — property 1.
    const value = await this.inner.lookup(ip);

    this.misses++;
    if (this.entries.size >= this.maxEntries) {
      // Oldest insertion first; Map preserves insertion order.
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(ip, { value, expiresAt: this.now() + this.ttlMs });
    return value;
  }
}
