/**
 * Territory schedule + geo pre-flight specs (D-B3). The posture under test
 * is FAIL-CLOSED: every malformed schedule, failed lookup, unknown country
 * or ambiguous region must land on "blocked" — never on "allowed".
 */
import { expect } from 'chai';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DEFAULT_TERRITORY_SCHEDULE,
  DEFAULT_WALLET_BLOCKLIST,
  GENERIC_REJECTION,
  LocalPacketSigner,
  MemoryAttestationStore,
  StubGeoLookup,
  VendorHttpGeoLookup,
  geoVerdict,
  issuePacket,
  parseTerritorySchedule,
  territoryAllowed,
  type PacketServiceDeps,
  type TerritorySchedule,
} from '../src';
import { base58Encode } from '../src/shared';

const WALLET = base58Encode(new Uint8Array(32).fill(3));
const POOL = base58Encode(new Uint8Array(32).fill(4));

/** The pool's on-chain numeric id; the route resolves the PDA to it before
 * writing a ciphertext (audit B-01). */
const POOL_ID = 7n;
const POOL_IDS = () => {
  const { MemoryPoolIdResolver } = require('../src/pool-ids');
  const r = new MemoryPoolIdResolver();
  r.set(POOL, POOL_ID);
  return r;
};

function schedule(overrides: Partial<TerritorySchedule> = {}): TerritorySchedule {
  return { ...DEFAULT_TERRITORY_SCHEDULE, ...overrides };
}

function deps(
  geo: () => Promise<{ country: string; region?: string; vpnOrProxy: boolean }>,
  territories: TerritorySchedule = schedule()
): PacketServiceDeps {
  const attestations = new MemoryAttestationStore();
  void attestations.put({
    wallet: WALLET,
    termsVersion: 1,
    attested18: true,
    timestamp: 1_756_000_000n,
    walletSignature: 'dGVzdA==',
  });
  return {
    geo: { lookup: geo },
    sanctions: { isSanctioned: async () => false },
    signer: new LocalPacketSigner(new Uint8Array(32).fill(7)),
    attestations,
    config: { blockedWallets: DEFAULT_WALLET_BLOCKLIST, territories, kycTier: 0, termsVersion: 1, termsUpdated: '2026-09-06' },
    now: () => 1_756_000_000n,
    nonce: () => 42n,
  };
}

const request = { wallet: WALLET, pool: POOL, ip: '203.0.113.7' };

describe('the committed territory schedule', () => {
  // Rewritten for schedule version 3 (founder instruction 2026-09-12 §3.1):
  // the PID §9 legal-review block, confirmed rows only. The previous
  // assertion named BE + AU, which was the whole policy from 2026-08-28.
  it('config/territories.json parses and matches the schedule this build enforces', () => {
    const committed = parseTerritorySchedule(
      readFileSync(join(__dirname, '..', '..', '..', 'config', 'territories.json'), 'utf8')
    );
    expect(committed.posture).to.equal(DEFAULT_TERRITORY_SCHEDULE.posture);
    expect(committed.allowed).to.deep.equal(DEFAULT_TERRITORY_SCHEDULE.allowed);
    expect(committed.blocked).to.deep.equal(DEFAULT_TERRITORY_SCHEDULE.blocked);
    expect(committed.version).to.be.at.least(1);
  });

  // Schedule version 4 (founder instruction 2026-09-21, register row
  // D-B3-3) adds `US`. It is the one code here that is NOT a confirmed PID §9
  // country row — §9 names twelve US states, which cannot be enforced while
  // the geo source resolves no region, so the country stands in for them and
  // is deliberately wider. Pinned by hand, like the rest, because the
  // schedule is founder-owned and a silent edit to it is the thing this test
  // exists to refuse.
  it('carries the fourteen confirmed PID §9 countries, plus US at country level, and nothing else', () => {
    const committed = parseTerritorySchedule(
      readFileSync(join(__dirname, '..', '..', '..', 'config', 'territories.json'), 'utf8')
    );
    expect(committed.blocked).to.deep.equal([
      'AE', 'AU', 'BE', 'BH', 'CN', 'HK', 'ID', 'IN', 'KW', 'MY', 'OM', 'QA', 'SA', 'SG', 'US',
    ]);
    // A block-list with a populated allow-list misstates the policy; the
    // parser refuses it, and this says so at the committed file too.
    expect(committed.allowed).to.deep.equal([]);
  });

  it('carries NO sub-national code, because nothing wired here can resolve a region', () => {
    // The PID §9 US-state rows are held on exactly this (see
    // config/territories.README.md). `assertRegionCapability` refuses to
    // start the service rather than admit the people such a row names, so a
    // code landing here would take the entry service down at deploy. This
    // is the same assertion `scripts/check-territories.ts` makes on the
    // change under review, kept here too because this suite is what runs on a
    // packet change.
    const committed = parseTerritorySchedule(
      readFileSync(join(__dirname, '..', '..', '..', 'config', 'territories.json'), 'utf8')
    );
    expect(committed.blocked.filter((c) => c.includes('-'))).to.deep.equal([]);
  });
});

describe('parseTerritorySchedule', () => {
  it('rejects every malformation rather than admitting anyone', () => {
    const bad = [
      'not json',
      '{}',
      '{"version":0,"allowed":[],"blocked":[],"updated":"x"}',
      '{"version":1,"allowed":"GB","blocked":[],"updated":"x"}',
      '{"version":1,"allowed":["gb"],"blocked":[],"updated":"x"}',
      '{"version":1,"allowed":["GBR"],"blocked":[],"updated":"x"}',
      '{"version":1,"allowed":["GB"],"blocked":["US-"],"updated":"x"}',
      '{"version":1,"allowed":["GB"],"blocked":[7],"updated":"x"}',
      '{"version":1,"allowed":["GB"],"blocked":[],"updated":""}',
      '{"version":2,"posture":"deny-list","allowed":[],"blocked":[],"updated":"x"}',
      // A populated allowlist under block-list posture misstates the policy.
      '{"version":2,"posture":"block-list","allowed":["GB"],"blocked":["BE"],"updated":"x"}',
    ];
    for (const text of bad) {
      expect(() => parseTerritorySchedule(text), text).to.throw();
    }
  });

  it('accepts country and country-region codes in blocked', () => {
    const s = parseTerritorySchedule(
      '{"version":2,"allowed":["GB","US"],"blocked":["FR","US-NY","US-WA"],"updated":"2026-08-27"}'
    );
    expect(s.blocked).to.include('US-NY');
  });

  it('a schedule without a posture reads as allow-list (the original schema)', () => {
    const s = parseTerritorySchedule(
      '{"version":1,"allowed":["GB"],"blocked":[],"updated":"2026-08-27"}'
    );
    expect(s.posture).to.equal('allow-list');
  });
});

describe('territoryAllowed (fail-closed decision table, allow-list posture)', () => {
  const s = schedule({ posture: 'allow-list', allowed: ['GB', 'US'], blocked: ['US-NY'] });
  const cases: Array<[string | undefined | null, string | undefined, boolean, string]> = [
    ['GB', undefined, true, 'allowed country'],
    ['US', 'CA', true, 'allowed country, unblocked region'],
    ['US', 'NY', false, 'region on the blocked list'],
    ['FR', undefined, false, 'country not on the allowed list'],
    [undefined, undefined, false, 'no country resolved'],
    [null, undefined, false, 'null country'],
    ['', undefined, false, 'empty country'],
    ['gb', undefined, false, 'malformed country code'],
    ['US', 'n/a!', false, 'ambiguous region resolves closed'],
  ];
  for (const [country, region, want, name] of cases) {
    it(name, () => {
      expect(territoryAllowed(s, country, region)).to.equal(want);
    });
  }

  it('an explicit country block wins over the allowed list', () => {
    const blocked = schedule({ posture: 'allow-list', allowed: ['GB'], blocked: ['GB'] });
    expect(territoryAllowed(blocked, 'GB')).to.equal(false);
  });
});

describe('territoryAllowed (block-list posture — the 2026-08-28 launch policy)', () => {
  const s = DEFAULT_TERRITORY_SCHEDULE; // block-list, blocked BE + AU
  const cases: Array<[string | undefined | null, string | undefined, boolean, string]> = [
    ['AR', undefined, true, 'an unlisted country is allowed'],
    ['GB', undefined, true, 'a formerly-allowlisted country stays allowed'],
    ['AR', 'B', true, 'unlisted country with a region is allowed'],
    // Was ['US','NY',true] until 2026-09-21: US was this file's example of an
    // UNLISTED country, and D-B3-3 listed it. The case it demonstrated is real
    // and still needs a country, so it moved; the inverse is now pinned below it.
    ['US', 'NY', false, 'the United States is blocked at country level, whatever the state (D-B3-3)'],
    ['US', undefined, false, 'the United States is blocked with no region resolved at all'],
    ['BE', undefined, false, 'Belgium is blocked'],
    ['AU', undefined, false, 'Australia is blocked'],
    ['AU', 'NSW', false, 'a blocked country stays blocked whatever the region'],
    [undefined, undefined, false, 'no country resolved — fail-closed survives the posture'],
    ['', undefined, false, 'empty country — fail-closed'],
    ['ar', undefined, false, 'malformed country code — fail-closed'],
    ['AR', 'n/a!', false, 'ambiguous region — fail-closed'],
  ];
  for (const [country, region, want, name] of cases) {
    it(name, () => {
      expect(territoryAllowed(s, country, region)).to.equal(want);
    });
  }

  it('a region block still works under block-list posture', () => {
    const withRegion = schedule({ blocked: ['BE', 'AU', 'US-NY'] });
    expect(territoryAllowed(withRegion, 'US', 'NY')).to.equal(false);
    expect(territoryAllowed(withRegion, 'US', 'CA')).to.equal(true);
  });
});

describe('packet issuance under the schedule', () => {
  it('refuses a blocked region with the one generic rejection', async () => {
    const s = schedule({ allowed: ['GB', 'US'], blocked: ['US-NY'] });
    const r = await issuePacket(
      deps(async () => ({ country: 'US', region: 'NY', vpnOrProxy: false }), s),
      request
    );
    expect(r).to.deep.equal(GENERIC_REJECTION);
  });

  it('a geo lookup failure refuses — fail-closed, still generic', async () => {
    const r = await issuePacket(
      deps(async () => {
        throw new Error('vendor down');
      }),
      request
    );
    expect(r).to.deep.equal(GENERIC_REJECTION);
  });
});

describe('geoVerdict (the /geo pre-flight)', () => {
  it('answers only a boolean, false on any failure', async () => {
    expect(await geoVerdict(deps(async () => ({ country: 'GB', vpnOrProxy: false })), '1.2.3.4')).to.equal(true);
    expect(await geoVerdict(deps(async () => ({ country: 'BE', vpnOrProxy: false })), '1.2.3.4')).to.equal(false);
    expect(await geoVerdict(deps(async () => ({ country: 'GB', vpnOrProxy: true })), '1.2.3.4')).to.equal(false);
    expect(
      await geoVerdict(
        deps(async () => {
          throw new Error('down');
        }),
        '1.2.3.4'
      )
    ).to.equal(false);
  });
});

describe('the geo adapters', () => {
  it('StubGeoLookup answers from constructor values and throws unconfigured', async () => {
    const fixed = new StubGeoLookup({ country: 'DE', vpnOrProxy: false });
    expect((await fixed.lookup('1.2.3.4')).country).to.equal('DE');
    const empty = new StubGeoLookup();
    const prev = process.env.GEO_STUB_COUNTRY;
    delete process.env.GEO_STUB_COUNTRY;
    try {
      let threw = false;
      await empty.lookup('1.2.3.4').catch(() => {
        threw = true;
      });
      expect(threw).to.equal(true, 'an unconfigured stub must block, not admit');
    } finally {
      if (prev !== undefined) process.env.GEO_STUB_COUNTRY = prev;
    }
  });

  it('VendorHttpGeoLookup maps the contract and throws on every bad answer', async () => {
    const ok = new VendorHttpGeoLookup('https://geo.example/v1', 'k', (async () => ({
      ok: true,
      json: async () => ({ country: 'US', region: 'NY', vpnOrProxy: false }),
    })) as unknown as typeof fetch);
    const got = await ok.lookup('203.0.113.7');
    expect(got).to.deep.equal({ country: 'US', region: 'NY', vpnOrProxy: false });

    const bad = [
      { ok: false, status: 500, json: async () => ({}) },
      { ok: true, json: async () => ({}) },
      { ok: true, json: async () => ({ country: '' }) },
    ];
    for (const answer of bad) {
      const vendor = new VendorHttpGeoLookup(
        'https://geo.example/v1',
        'k',
        (async () => answer) as unknown as typeof fetch
      );
      let threw = false;
      await vendor.lookup('203.0.113.7').catch(() => {
        threw = true;
      });
      expect(threw).to.equal(true);
    }
  });
});

describe('the /geo route and the header stub', () => {
  const { handleEntryRoute } = require('../src/server');
  const { MemoryCiphertextStore } = require('../../sealing/src');

  function serverDeps(trustGeoStubHeaders: boolean) {
    return {
      packet: deps(async () => ({ country: 'GB', vpnOrProxy: false })),
      ciphertexts: new MemoryCiphertextStore(),
      poolIds: POOL_IDS(),
      seats: new (require('../src/seats').MemorySeatResolver)(),
      trustProxyHeader: false,
      trustGeoStubHeaders,
    };
  }

  it('GET /geo answers the verdict; POST is refused', async () => {
    const d = serverDeps(false);
    const ok = await handleEntryRoute(d, 'GET', '/geo', null, '1.2.3.4');
    expect(ok).to.deep.equal({ status: 200, body: { allowed: true } });
    const post = await handleEntryRoute(d, 'POST', '/geo', null, '1.2.3.4');
    expect(post.status).to.equal(405);
  });

  it('stub headers override the lookup ONLY when the dep opts in', async () => {
    const trusted = serverDeps(true);
    const blocked = await handleEntryRoute(trusted, 'GET', '/geo', null, '1.2.3.4', {
      'x-geo-country': 'BE',
    });
    expect(blocked.body).to.deep.equal({ allowed: false });

    const untrusted = serverDeps(false);
    const ignored = await handleEntryRoute(untrusted, 'GET', '/geo', null, '1.2.3.4', {
      'x-geo-country': 'BE',
    });
    expect(ignored.body).to.deep.equal({ allowed: true }, 'headers ignored without the opt-in');
  });

  it('a blocked territory refuses the packet through the same route', async () => {
    const d = serverDeps(true);
    const res = await handleEntryRoute(
      d,
      'POST',
      '/packet',
      { wallet: WALLET, pool: POOL },
      '1.2.3.4',
      { 'x-geo-country': 'BE' }
    );
    expect(res.status).to.equal(403);
    expect(res.body).to.deep.equal(GENERIC_REJECTION);
  });
});
