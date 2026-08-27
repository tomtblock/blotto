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
    config: { territories, kycTier: 0, termsVersion: 1 },
    now: () => 1_756_000_000n,
    nonce: () => 42n,
  };
}

const request = { wallet: WALLET, pool: POOL, ip: '203.0.113.7' };

describe('the committed territory schedule', () => {
  it('config/territories.json parses and matches the R2 launch policy', () => {
    const committed = parseTerritorySchedule(
      readFileSync(join(__dirname, '..', '..', '..', 'config', 'territories.json'), 'utf8')
    );
    expect(committed.allowed).to.deep.equal(DEFAULT_TERRITORY_SCHEDULE.allowed);
    expect(committed.blocked).to.deep.equal(DEFAULT_TERRITORY_SCHEDULE.blocked);
    expect(committed.version).to.be.at.least(1);
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
});

describe('territoryAllowed (fail-closed decision table)', () => {
  const s = schedule({ allowed: ['GB', 'US'], blocked: ['US-NY'] });
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
    const blocked = schedule({ allowed: ['GB'], blocked: ['GB'] });
    expect(territoryAllowed(blocked, 'GB')).to.equal(false);
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
    expect(await geoVerdict(deps(async () => ({ country: 'FR', vpnOrProxy: false })), '1.2.3.4')).to.equal(false);
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
      'x-geo-country': 'FR',
    });
    expect(blocked.body).to.deep.equal({ allowed: false });

    const untrusted = serverDeps(false);
    const ignored = await handleEntryRoute(untrusted, 'GET', '/geo', null, '1.2.3.4', {
      'x-geo-country': 'FR',
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
      { 'x-geo-country': 'US' }
    );
    expect(res.status).to.equal(403);
    expect(res.body).to.deep.equal(GENERIC_REJECTION);
  });
});
