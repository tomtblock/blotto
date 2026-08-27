/**
 * GeoLookup adapters (D-B3). The vendor of record is not yet contracted
 * (R2), so the production adapter is a SEAM: `VendorHttpGeoLookup` speaks a
 * minimal HTTP contract with injected fetch, and `StubGeoLookup` serves
 * tests and development, answering from constructor values or environment
 * variables. Every failure path in every adapter throws — the packet
 * service catches and answers with the one generic rejection, which is what
 * makes the whole geo path fail-closed.
 */

import type { GeoLookup, GeoLookupResult } from './service';

/**
 * Test/dev stub. Resolution order per field: constructor value, then
 * environment (`GEO_STUB_COUNTRY`, `GEO_STUB_REGION`, `GEO_STUB_VPN=1`),
 * else throws — an unconfigured stub must block, not admit.
 */
export class StubGeoLookup implements GeoLookup {
  constructor(
    private readonly fixed: { country?: string; region?: string; vpnOrProxy?: boolean } = {}
  ) {}

  async lookup(_ip: string): Promise<GeoLookupResult> {
    const country = this.fixed.country ?? process.env.GEO_STUB_COUNTRY;
    if (!country) throw new Error('StubGeoLookup: no country configured');
    return {
      country,
      region: this.fixed.region ?? process.env.GEO_STUB_REGION ?? undefined,
      vpnOrProxy: this.fixed.vpnOrProxy ?? process.env.GEO_STUB_VPN === '1',
    };
  }
}

/**
 * The vendor seam. Contract: GET `${baseUrl}?ip=<addr>` with the API key in
 * an Authorization header, answering
 * `{ "country": "GB", "region": "ENG" | null, "vpnOrProxy": false }`.
 * Anything else — non-200, malformed body, missing country — throws, and the
 * caller's generic rejection blocks the entry. The concrete vendor adapter
 * replaces or subclasses this once the vendor of record is contracted; the
 * shape is unit-tested with injected fetch today.
 */
export class VendorHttpGeoLookup implements GeoLookup {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async lookup(ip: string): Promise<GeoLookupResult> {
    const res = await this.fetchImpl(`${this.baseUrl}?ip=${encodeURIComponent(ip)}`, {
      headers: { authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`geo vendor: ${res.status}`);
    const body = (await res.json()) as {
      country?: unknown;
      region?: unknown;
      vpnOrProxy?: unknown;
    };
    if (typeof body.country !== 'string' || body.country.length === 0) {
      throw new Error('geo vendor: no country in answer');
    }
    return {
      country: body.country,
      region: typeof body.region === 'string' && body.region.length > 0 ? body.region : undefined,
      vpnOrProxy: body.vpnOrProxy === true,
    };
  }
}
