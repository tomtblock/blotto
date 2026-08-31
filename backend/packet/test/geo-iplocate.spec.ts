/**
 * The IPLocate adapter and the per-IP cache.
 *
 * The fixture is a REAL response captured from the live API on 2026-08-31
 * (8.8.8.8), not a hand-written guess at the shape — the previous adapter
 * was a generic seam whose invented contract matched no vendor.
 */

import { strict as assert } from 'assert';
import { IpLocateGeoLookup, GeoQuotaError, GeoAuthError } from '../src/geo-iplocate';
import { CachingGeoLookup } from '../src/geo-cache';
import { geoVerdict } from '../src/service';
import type { GeoLookup } from '../src/service';
import { loadTerritorySchedule } from '../src/territories';
import { resolve } from 'path';

const TERRITORIES = loadTerritorySchedule(
  resolve(__dirname, '..', '..', '..', 'config', 'territories.json')
);

// Captured verbatim from https://iplocate.io/api/lookup/8.8.8.8, trimmed to
// the fields the adapter reads plus enough context to stay recognisable.
const LIVE_BODY = {
  ip: '8.8.8.8',
  country: 'United States',
  country_code: 'US',
  city: 'Mountain View',
  subdivision: 'California',
  privacy: {
    is_abuser: false,
    is_anonymous: false,
    is_bogon: false,
    is_hosting: true,
    is_icloud_relay: false,
    is_proxy: false,
    is_tor: false,
    is_vpn: false,
  },
};

const answering = (status: number, body: unknown, capture?: { url?: string; key?: string }) =>
  (async (url: string, init?: { headers?: Record<string, string> }) => {
    if (capture) {
      capture.url = String(url);
      capture.key = init?.headers?.['X-API-Key'];
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;

const make = (fetchImpl: typeof fetch, over: Record<string, unknown> = {}) =>
  new IpLocateGeoLookup({
    baseUrl: 'https://iplocate.io/api/lookup',
    apiKey: 'k',
    fetchImpl,
    sleep: async () => undefined,
    ...over,
  });

describe('IpLocateGeoLookup — the live contract', () => {
  it('calls the PATH form with the X-API-Key header', async () => {
    const seen: { url?: string; key?: string } = {};
    await make(answering(200, LIVE_BODY, seen)).lookup('8.8.8.8');
    assert.equal(seen.url, 'https://iplocate.io/api/lookup/8.8.8.8');
    assert.equal(seen.key, 'k');
  });

  it('maps country_code, and NEVER forwards subdivision as a region', async () => {
    const r = await make(answering(200, LIVE_BODY)).lookup('8.8.8.8');
    assert.equal(r.country, 'US');
    // "California" would fail territoryAllowed's region shape check and
    // fail-close every lookup on earth. This assertion is the guard.
    assert.equal(r.region, undefined);
  });

  it('does not treat datacentre hosting as anonymisation', async () => {
    // is_hosting is true in the live fixture; the entrants may run from one.
    const r = await make(answering(200, LIVE_BODY)).lookup('8.8.8.8');
    assert.equal(r.vpnOrProxy, false);
  });

  it('flags each real anonymisation signal', async () => {
    for (const flag of ['is_vpn', 'is_proxy', 'is_tor', 'is_anonymous']) {
      const body = { ...LIVE_BODY, privacy: { ...LIVE_BODY.privacy, [flag]: true } };
      const r = await make(answering(200, body)).lookup('1.1.1.1');
      assert.equal(r.vpnOrProxy, true, `${flag} must set vpnOrProxy`);
    }
  });

  it('throws on a missing or malformed country_code', async () => {
    for (const bad of [{}, { country_code: '' }, { country_code: 'USA' }, { country_code: 7 }]) {
      await assert.rejects(() => make(answering(200, bad)).lookup('1.1.1.1'), /country_code/);
    }
  });
});

describe('IpLocateGeoLookup — spending the quota carefully', () => {
  it('NEVER retries a 429 — retrying an exhausted cap spends the reserve', async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      return { ok: false, status: 429, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;
    await assert.rejects(() => make(f).lookup('1.1.1.1'), GeoQuotaError);
    assert.equal(calls, 1, 'a rate-limited request must be attempted exactly once');
  });

  it('names quota exhaustion distinctly from a territory block', async () => {
    const f = (async () => ({ ok: false, status: 429, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    await assert.rejects(() => make(f).lookup('1.1.1.1'), (e: unknown) => {
      assert.ok(e instanceof GeoQuotaError);
      assert.match(e.message, /QUOTA OR RATE LIMIT/);
      assert.match(e.message, /NOT a territory block/);
      return true;
    });
  });

  it('never retries a refused credential', async () => {
    for (const status of [401, 403]) {
      let calls = 0;
      const f = (async () => {
        calls++;
        return { ok: false, status, json: async () => ({}) } as Response;
      }) as unknown as typeof fetch;
      await assert.rejects(() => make(f).lookup('1.1.1.1'), GeoAuthError);
      assert.equal(calls, 1, `HTTP ${status} must not be retried`);
    }
  });

  it('retries a 5xx and succeeds', async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      return calls < 3
        ? ({ ok: false, status: 503, json: async () => ({}) } as Response)
        : ({ ok: true, status: 200, json: async () => LIVE_BODY } as Response);
    }) as unknown as typeof fetch;
    const r = await make(f).lookup('8.8.8.8');
    assert.equal(r.country, 'US');
    assert.equal(calls, 3);
  });

  it('retries a network fault, then gives up within the attempt budget', async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      throw new Error('socket hang up');
    }) as unknown as typeof fetch;
    await assert.rejects(() => make(f, { attempts: 3 }).lookup('1.1.1.1'), /unreachable after 3/);
    assert.equal(calls, 3, 'the attempt budget is a hard bound — no storm');
  });
});

describe('CachingGeoLookup', () => {
  const stub = (impl: () => Promise<{ country: string; vpnOrProxy: boolean }>): GeoLookup => ({
    lookup: impl,
  });

  it('serves a repeat address without asking the vendor again', async () => {
    let calls = 0;
    const c = new CachingGeoLookup(
      stub(async () => {
        calls++;
        return { country: 'GB', vpnOrProxy: false };
      })
    );
    await c.lookup('1.2.3.4');
    await c.lookup('1.2.3.4');
    await c.lookup('1.2.3.4');
    assert.equal(calls, 1);
    assert.equal(c.hits, 2);
    assert.equal(c.misses, 1);
  });

  it('keys strictly on the address — a different IP is a different question', async () => {
    let calls = 0;
    const c = new CachingGeoLookup(
      stub(async () => {
        calls++;
        return { country: 'GB', vpnOrProxy: false };
      })
    );
    await c.lookup('1.2.3.4');
    await c.lookup('5.6.7.8');
    assert.equal(calls, 2);
  });

  it('NEVER caches a failure — an unavailable vendor must not become an answer', async () => {
    let calls = 0;
    const c = new CachingGeoLookup(
      stub(async () => {
        calls++;
        throw new GeoQuotaError(429);
      })
    );
    await assert.rejects(() => c.lookup('1.2.3.4'), GeoQuotaError);
    await assert.rejects(() => c.lookup('1.2.3.4'), GeoQuotaError);
    assert.equal(calls, 2, 'each attempt must reach the vendor; nothing is stored');
    assert.equal(c.hits, 0);
  });

  it('expires an entry after its TTL', async () => {
    let calls = 0;
    let clock = 1_000;
    const c = new CachingGeoLookup(
      stub(async () => {
        calls++;
        return { country: 'GB', vpnOrProxy: false };
      }),
      { ttlMs: 1000, now: () => clock }
    );
    await c.lookup('1.2.3.4');
    clock += 999;
    await c.lookup('1.2.3.4');
    assert.equal(calls, 1, 'still inside the TTL');
    clock += 2;
    await c.lookup('1.2.3.4');
    assert.equal(calls, 2, 'past the TTL, the vendor is asked again');
  });

  it('stays bounded under a long run', async () => {
    const c = new CachingGeoLookup(stub(async () => ({ country: 'GB', vpnOrProxy: false })), {
      maxEntries: 10,
    });
    for (let i = 0; i < 100; i++) await c.lookup(`10.0.0.${i}`);
    assert.ok(c.misses === 100);
  });
});

/**
 * The gap that made 2026-08-31 expensive: `/geo` answered `false` for a
 * vendor fault and for a blocked country identically, and logged neither.
 * The caller must still learn nothing; the operator must learn everything.
 */
describe('the geo decision is named in the log, never in the answer', () => {
  const capture = async (fn: () => Promise<unknown>) => {
    const lines: string[] = [];
    const spy = console.log;
    console.log = (m?: unknown) => void lines.push(String(m));
    try {
      return { result: await fn(), lines };
    } finally {
      console.log = spy;
    }
  };
  const deps = (lookup: () => Promise<{ country: string; vpnOrProxy: boolean }>) =>
    ({
      geo: { lookup },
      config: { territories: TERRITORIES, termsVersion: 1, kycTier: 0 },
    }) as never;

  it('names a LOOKUP FAILURE distinctly from a territory decision', async () => {
    const { result, lines } = await capture(() =>
      geoVerdict(
        deps(async () => {
          throw new GeoQuotaError(429);
        }),
        '203.0.113.7'
      )
    );
    assert.equal(result, false, 'the answer stays fail-closed and unchanged');
    const line = lines.find((l) => l.includes('geo BLOCK'));
    assert.ok(line, 'the decision must be logged');
    assert.match(line, /LOOKUP FAILED/);
    assert.match(line, /NOT a territory decision/);
    assert.match(line, /QUOTA OR RATE LIMIT/, "the vendor's own reason carries through");
  });

  it('names a territory block as a territory block', async () => {
    const { result, lines } = await capture(() =>
      geoVerdict(deps(async () => ({ country: 'BE', vpnOrProxy: false })), '203.0.113.7')
    );
    assert.equal(result, false);
    assert.match(lines.find((l) => l.includes('geo BLOCK'))!, /territory schedule: BE/);
  });

  it('names a vpn block as a vpn block', async () => {
    const { lines } = await capture(() =>
      geoVerdict(deps(async () => ({ country: 'AR', vpnOrProxy: true })), '203.0.113.7')
    );
    assert.match(lines.find((l) => l.includes('geo BLOCK'))!, /vpn\/proxy\/tor/);
  });

  it('logs an allow, and Argentina is one', async () => {
    const { result, lines } = await capture(() =>
      geoVerdict(deps(async () => ({ country: 'AR', vpnOrProxy: false })), '203.0.113.7')
    );
    assert.equal(result, true, 'AR is not on the block list');
    assert.match(lines.find((l) => l.includes('geo ALLOW'))!, /country=AR/);
  });

  it('never writes a whole address to the log', async () => {
    const { lines } = await capture(() =>
      geoVerdict(deps(async () => ({ country: 'AR', vpnOrProxy: false })), '203.0.113.7')
    );
    const line = lines.find((l) => l.includes('geo '))!;
    assert.ok(!line.includes('203.0.113.7'), 'the full address must not be logged');
    assert.match(line, /203\.0\.x\.x/);
  });
});
