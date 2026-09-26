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
import { assertRegionCapability, geoVerdict } from '../src/service';
import type { GeoLookup } from '../src/service';
import { loadTerritorySchedule } from '../src/territories';
import { DEFAULT_WALLET_BLOCKLIST } from '../src/blocked-wallets';
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

/**
 * The deadline covers the BODY as well as the head (audit 2026-09-11, G-07 —
 * the defect the sanctions vendors had in `withRetry`, in the adapter the
 * taxonomy was lifted from). The shape is `sanctions/test/ofac-sdn.spec.ts`'s
 * stalled-body case: a vendor that accepts the connection, answers 200, and
 * then stops sending. Every status branch is satisfied, nothing has failed,
 * and `res.json()` never settles — so the entry gate waits for ever.
 */
describe('IpLocateGeoLookup — the deadline covers the whole exchange', () => {
  /** 200 with headers, then silence: the body settles only when aborted. */
  const headThenStall = (calls?: { n: number }): typeof fetch =>
    (async (_url: string, init?: RequestInit) => {
      if (calls) calls.n++;
      const signal = init?.signal ?? undefined;
      return {
        ok: true,
        status: 200,
        json: () =>
          new Promise<unknown>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(signal.reason));
          }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

  it('aborts a stalled BODY on its own deadline and names the phase', async () => {
    const calls = { n: 0 };
    const started = Date.now();
    await assert.rejects(
      () => make(headThenStall(calls), { attempts: 2, timeoutMs: 50 }).lookup('8.8.8.8'),
      /no readable answer after 2 attempts — geo vendor: timed out after 50ms reading the response body/
    );
    assert.equal(calls.n, 2, 'a stalled body is transient, like a stalled head');
    assert.ok(
      Date.now() - started < 5_000,
      'it returned on its own deadline, not on the test runner giving up'
    );
  });

  it('aborts a stalled HEAD too, saying which phase stalled', async () => {
    const neverAnswers = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal ?? undefined;
        signal?.addEventListener('abort', () => reject(signal.reason));
      })) as unknown as typeof fetch;
    await assert.rejects(
      () => make(neverAnswers, { attempts: 1, timeoutMs: 50 }).lookup('8.8.8.8'),
      /timed out after 50ms awaiting the response head/
    );
  });

  it('a complete but malformed body is NOT retried as a stall', async () => {

    let calls = 0;
    const f = (async () => {
      calls++;
      return { ok: true, status: 200, json: async () => ({ country_code: 'USA' }) } as Response;
    }) as unknown as typeof fetch;
    await assert.rejects(() => make(f, { attempts: 3 }).lookup('8.8.8.8'), /country_code/);
    assert.equal(calls, 1, 'a bad answer is an answer; retrying it spends the allowance');
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
      config: { blockedWallets: DEFAULT_WALLET_BLOCKLIST, territories: TERRITORIES, termsVersion: 1, termsUpdated: '2026-09-06', kycTier: 0 },
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

/**
 * Sub-national rules and the adapter that cannot feed them (audit
 * 2026-09-11, C-30).
 *
 * `config/territories.json` accepts `"US-NY"`, `territoryAllowed` honours it,
 * and the production adapter returns no region at all — so such a line would
 * admit every person it names, silently, with the country-level lines beside
 * it working normally. the Phase 0 record's accepted gap named a boot
 * assertion as the prerequisite for the first such rule; it did not exist.
 */
describe('sub-national rules are enforceable or refused, never inert (C-30)', () => {
  const countryOnly = {
    version: 2,
    posture: 'block-list' as const,
    allowed: [],
    blocked: ['BE', 'AU'],
    updated: '2026-08-28',
  };
  const subNational = { ...countryOnly, blocked: ['BE', 'AU', 'US-NY'] };

  const noRegion: GeoLookup = { async lookup() { return { country: 'US', vpnOrProxy: false }; } };
  const withRegion: GeoLookup = {
    resolvesRegion: true,
    async lookup() {
      return { country: 'US', region: 'CA', vpnOrProxy: false };
    },
  };

  it('the production adapter declares that it resolves no region', () => {
    const vendor = new IpLocateGeoLookup({ baseUrl: 'https://x/y', apiKey: 'k' });
    assert.equal(vendor.resolvesRegion, false, 'declared, not merely described in a comment');
  });

  it("today's country-only schedule passes the boot assertion with any adapter", () => {
    assertRegionCapability(countryOnly, new IpLocateGeoLookup({ baseUrl: 'https://x/y', apiKey: 'k' }));
    assertRegionCapability(countryOnly, noRegion);
  });

  it('a sub-national rule + the production adapter REFUSES to start, and says what to do', () => {
    assert.throws(
      () => assertRegionCapability(subNational, new IpLocateGeoLookup({ baseUrl: 'https://x/y', apiKey: 'k' })),
      /US-NY.*does not resolve a region|does not resolve a region/s
    );
    try {
      assertRegionCapability(subNational, noRegion);
      assert.fail('should throw');
    } catch (e) {
      const m = (e as Error).message;
      assert.match(m, /US-NY/, 'names the rule that would be inert');
      assert.match(m, /remove the sub-national entries|resolvesRegion/, 'names both remedies');
    }
  });

  it('an UNDECLARED capability is treated as absent — not proven is not allowed', () => {
    assert.throws(() => assertRegionCapability(subNational, { lookup: noRegion.lookup }), /region/);
  });

  it('an adapter that DOES resolve regions passes', () => {
    assertRegionCapability(subNational, withRegion);
  });

  it('second line: the entry itself is refused when the rule cannot be applied', async () => {
    const depsWithSchedule = (territories: typeof countryOnly) =>
      ({
        geo: noRegion,
        preflightGeo: noRegion,
        config: { blockedWallets: DEFAULT_WALLET_BLOCKLIST, territories, kycTier: 0, termsVersion: 1, termsUpdated: '2026-09-06' },
      }) as unknown as Parameters<typeof geoVerdict>[0];

    assert.equal(
      await geoVerdict(depsWithSchedule(subNational), '8.8.8.8'),
      false,
      'a US visitor is refused while a US-NY rule cannot be tested'
    );
    // The same schedule with no US rule admits them: it is the unenforceable
    // rule that blocks, not the country.
    assert.equal(await geoVerdict(depsWithSchedule(countryOnly), '8.8.8.8'), true);
  });
});
