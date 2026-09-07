/**
 * A short-lived, bounded, per-address cache in front of any `SanctionsCheck`
 * — `backend/packet/src/geo-cache.ts` with the key changed, and the same
 * three properties, all tested:
 *
 *   1. A FAILURE IS NEVER CACHED. A throw propagates and stores nothing, so
 *      an unavailable vendor can never produce a stored "not listed".
 *   2. THE KEY IS THE ADDRESS ITSELF. List membership is a pure function of
 *      the address; nothing the caller controls can carry a verdict from
 *      one address to another.
 *   3. A SHORT TTL, so a designation published this morning is picked up
 *      within minutes rather than persisting for the run. Defaults to
 *      fifteen minutes; the settlement path may want it shorter still.
 */

import type { SanctionsCheck, SanctionsVerdict } from './seam';

interface Entry {
  value: SanctionsVerdict;
  expiresAt: number;
}

export interface SanctionsCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

export class CachingSanctionsCheck implements SanctionsCheck {
  private readonly entries = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  hits = 0;
  misses = 0;

  constructor(
    private readonly inner: SanctionsCheck,
    options: SanctionsCacheOptions = {}
  ) {
    this.ttlMs = options.ttlMs ?? 15 * 60 * 1000;
    this.maxEntries = options.maxEntries ?? 4096;
    this.now = options.now ?? Date.now;
  }

  async screen(address: string): Promise<SanctionsVerdict> {
    const hit = this.entries.get(address);
    if (hit && hit.expiresAt > this.now()) {
      this.hits++;
      return hit.value;
    }
    if (hit) this.entries.delete(address);

    // A throw propagates untouched and stores NOTHING — property 1.
    const value = await this.inner.screen(address);

    this.misses++;
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(address, { value, expiresAt: this.now() + this.ttlMs });
    return value;
  }
}
