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
 * The GENERIC vendor seam — NOT the vendor of record, and NOT to be pointed
 * at IPLocate. It sends `Authorization: Bearer`, which IPLocate ignores:
 * a wrong key answers 200 with unauthenticated free-tier data, so wiring it
 * would authenticate nothing while appearing to work. Use
 * `IpLocateGeoLookup` below. This class stays as the shape a future second
 * vendor is written against.
 *
 * Contract: GET `${baseUrl}?ip=<addr>` with the API key in
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

/**
 * IPLocate (iplocate.io) — the vendor of record for the devnet rehearsal
 * and the concrete replacement for the `GEO_STUB_COUNTRY` stub.
 *
 * Contract, verified against the live API on 2026-08-28:
 *
 *   GET `${baseUrl}/${ip}`   with `X-API-Key: <key>`
 *   → `{ "country": "United States", "country_code": "US",
 *        "subdivision": "California",
 *        "privacy": { "is_vpn": false, "is_proxy": false, "is_tor": false, … } }`
 *
 * Three deliberate differences from `VendorHttpGeoLookup`, each measured
 * rather than assumed:
 *
 *  1. The address is a PATH segment, not a `?ip=` query parameter.
 *  2. The key rides `X-API-Key`. A bad key there answers 401, so the header
 *     is genuinely read. `Authorization: Bearer` is IGNORED by this vendor —
 *     a bad key sent that way answers 200 with unauthenticated free-tier data.
 *     That is why this adapter exists instead of a base-URL swap: pointing
 *     `VendorHttpGeoLookup` at IPLocate would authenticate nothing and
 *     silently consume the unauthenticated quota. Keeping the key out of the URL
 *     also keeps it out of proxy and access logs.
 *  3. The country we gate on is `country_code` (ISO alpha-2). The `country`
 *     field is the full NAME ("United States"), which `territoryAllowed`
 *     rejects as malformed — fail-closed, but a silent 100% block.
 *
 * # Region is deliberately not emitted
 *
 * IPLocate answers `subdivision` as a full name ("California"), never a
 * code, and `territoryAllowed` treats a non-code region as ambiguous and
 * blocks. Passing it through would block every visitor whose address
 * resolves a subdivision. So this adapter emits no region — which means it
 * can enforce COUNTRY-level rules only. `assertScheduleEvaluable` (main.ts)
 * refuses to boot if the founder's schedule contains a sub-national rule
 * this adapter cannot evaluate: silently under-enforcing the founder's
 * schedule is the one failure mode worse than not starting.
 *
 * Every failure path throws, exactly as the seam requires; the caller
 * answers the single `GENERIC_REJECTION` and the entry is blocked.
 */
export class IpLocateGeoLookup implements GeoLookup {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async lookup(ip: string): Promise<GeoLookupResult> {
    const base = this.baseUrl.replace(/\/+$/, '');
    const res = await this.fetchImpl(`${base}/${encodeURIComponent(ip)}`, {
      headers: { 'x-api-key': this.apiKey },
    });
    if (!res.ok) throw new Error(`geo vendor: ${res.status}`);
    const body = (await res.json()) as {
      country_code?: unknown;
      privacy?: { is_vpn?: unknown; is_proxy?: unknown; is_tor?: unknown };
    };
    const code = body.country_code;
    // ISO alpha-2 or nothing — an unresolvable location must not become a
    // country string that happens to pass a later check.
    if (typeof code !== 'string' || !/^[A-Z]{2}$/.test(code)) {
      throw new Error('geo vendor: no ISO country code in answer');
    }
    const privacy = body.privacy;
    if (privacy === undefined || privacy === null || typeof privacy !== 'object') {
      throw new Error('geo vendor: no privacy block in answer');
    }
    // PHASE-5-REVIEW: `GeoLookupResult.vpnOrProxy`'s doc comment says
    // "VPN/proxy/hosting exit", but `privacy.is_hosting` is true for every
    // datacenter address (8.8.8.8 included) — enforcing it would block all
    // cloud-originated traffic, our own Playwright rehearsal among it. This
    // adapter reads VPN, proxy and Tor only; whether hosting should also
    // block is a founder call, raised in the Stage A follow-up.
    return {
      country: code,
      region: undefined,
      vpnOrProxy:
        privacy.is_vpn === true || privacy.is_proxy === true || privacy.is_tor === true,
    };
  }
}

/**
 * Refuse to run a schedule this geo adapter cannot fully enforce.
 *
 * `blocked` accepts sub-national entries ("US-NY"). An adapter that emits
 * no region can never match one, so such a rule would sit in the founder's
 * committed config looking enforced while admitting everyone it names.
 * Fail-closed means the service does not start rather than under-enforce.
 * Country-level entries ("BE", "AU") are unaffected.
 */
export function assertScheduleEvaluable(
  blocked: readonly string[],
  adapterEmitsRegion: boolean
): void {
  if (adapterEmitsRegion) return;
  const subNational = blocked.filter((code) => code.includes('-'));
  if (subNational.length > 0) {
    throw new Error(
      `packet: the territory schedule blocks ${subNational.join(', ')}, but the ` +
        'configured geo vendor resolves no region code — this rule cannot be ' +
        'enforced. Remove it or wire a vendor that answers region codes.'
    );
  }
}
