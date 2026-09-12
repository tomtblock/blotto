/**
 * Three entry-gate defects from the 2026-09-11 audit, in one file because
 * they share a cause: a setting that is wrong produces a running service
 * rather than a stopped one.
 *
 *   E-20      numeric env vars parsed with a bare `Number()`, so a blank
 *             value becomes 0 and garbage becomes NaN, silently;
 *   E-03/C-31 the geo stub selectable from a single variable, with none of
 *             the explicit opt-in every other development seam demands;
 *   B-13      the socket layer's catch-all answering 500 and logging
 *             nothing at all.
 */
import { expect } from 'chai';
import { createServer, type Server } from 'http';
import { AddressInfo } from 'net';
import { intEnv, optionalIntEnv, portEnv } from '../../_shared/src/env-number';
import { buildGeo } from '../src/main';
import { serveEntryApi, type EntryServerDeps } from '../src/server';
import { MemoryPoolIdResolver } from '../src/pool-ids';
import { MemoryCiphertextStore } from '../../sealing/src';
import type { Monitor } from '../../_shared/src/monitor';

const silentMonitor: Monitor = {
  recordEvent: () => undefined,
  reportGauge: () => undefined,
  alert: () => undefined,
};

describe('numeric settings fail fast (E-20)', () => {
  it('takes the default only when the variable is truly absent', () => {
    expect(intEnv({}, 'X', 7)).to.equal(7);
    expect(intEnv({ X: '12' }, 'X', 7)).to.equal(12);
    expect(intEnv({ X: ' 12 ' }, 'X', 7), 'surrounding space is an editor, not a value').to.equal(
      12
    );
  });

  it('refuses a variable that is set but blank, rather than reading it as zero', () => {
    // The real shape of this: a cleared Fly secret, an unresolved CI
    // expression, or a bare `GEO_CACHE_TTL_MS=` line in a .env file. Number('')
    // is 0, which turned the per-address cache off and started paying the geo
    // vendor twice per entrant, with nothing said anywhere.
    expect(() => intEnv({ X: '' }, 'X', 7)).to.throw(/set but empty/);
    expect(() => intEnv({ X: '   ' }, 'X', 7)).to.throw(/set but empty/);
  });

  it('refuses anything that is not a whole number', () => {
    for (const bad of ['4000ms', 'abc', '1.5', '1e3', '0x10', '1,000', '--3']) {
      expect(() => intEnv({ X: bad }, 'X', 7), bad).to.throw(/whole number/);
    }
  });

  it('refuses a number too large to be exact', () => {
    expect(() => intEnv({ X: '99999999999999999999' }, 'X', 7)).to.throw(/too large/);
  });

  it('enforces the bounds it is given', () => {
    expect(() => intEnv({ X: '0' }, 'X', 7, { min: 1 })).to.throw(/at least 1/);
    expect(() => intEnv({ X: '9' }, 'X', 7, { max: 5 })).to.throw(/at most 5/);
    expect(intEnv({ X: '5' }, 'X', 7, { min: 1, max: 5 })).to.equal(5);
  });

  it('optionalIntEnv keeps absence meaningful', () => {
    expect(optionalIntEnv({}, 'X')).to.equal(undefined);
    expect(optionalIntEnv({ X: '0' }, 'X')).to.equal(0);
    expect(() => optionalIntEnv({ X: '' }, 'X')).to.throw(/set but empty/);
  });

  it('a port is 1-65535, never 0', () => {
    // Port 0 is not an error to the operating system: it binds a random port
    // and the service comes up healthy on an address nothing routes to.
    expect(() => portEnv({ P: '0' }, 'P', 8082)).to.throw(/at least 1/);
    expect(() => portEnv({ P: '70000' }, 'P', 8082)).to.throw(/at most 65535/);
    expect(portEnv({}, 'P', 8082)).to.equal(8082);
  });

  it('every error names the variable, because that is the whole point', () => {
    for (const bad of ['', 'abc', '1.5']) {
      try {
        intEnv({ GEO_CACHE_TTL_MS: bad }, 'GEO_CACHE_TTL_MS', 1);
        expect.fail(`expected a refusal for ${JSON.stringify(bad)}`);
      } catch (e) {
        expect((e as Error).message).to.contain('GEO_CACHE_TTL_MS');
      }
    }
  });
});

describe('the geo stub needs an explicit opt-in (E-03 / C-31)', () => {
  const STUB = { GEO_STUB_COUNTRY: 'GB' } as NodeJS.ProcessEnv;

  it('refuses the stub when the opt-in is absent', () => {
    expect(() => buildGeo(STUB, silentMonitor)).to.throw(/ALLOW_STUB_GEO/);
  });

  it('refuses the stub when the opt-in is set to anything but "1"', () => {
    for (const value of ['0', 'true', 'yes', '']) {
      expect(
        () => buildGeo({ ...STUB, ALLOW_STUB_GEO: value }, silentMonitor),
        value
      ).to.throw(/ALLOW_STUB_GEO/);
    }
  });

  it('selects the stub only with the opt-in, and says so out loud', () => {
    const geo = buildGeo({ ...STUB, ALLOW_STUB_GEO: '1' }, silentMonitor);
    expect(geo.describe).to.contain('STUB');
  });

  it('a vendor pair still wins, opt-in or not', () => {
    const vendor = buildGeo(
      { GEO_VENDOR_URL: 'https://geo.example', GEO_VENDOR_API_KEY: 'k', ...STUB },
      silentMonitor
    );
    expect(vendor.describe).to.not.contain('STUB');
  });

  it('a lost vendor key stops the service instead of falling through to the stub', () => {
    // THE defect, stated as the deployment that produces it: the key is
    // rotated out of band and GEO_VENDOR_API_KEY goes missing, while
    // GEO_STUB_COUNTRY is still set on the machine from an earlier run. The
    // old selector dropped straight through to a stub that answers every
    // address with one country, and the entry gate went on returning
    // verdicts and looking perfectly healthy while screening nobody.
    expect(() => buildGeo({ GEO_VENDOR_URL: 'https://geo.example', ...STUB }, silentMonitor)).to.throw(
      /ALLOW_STUB_GEO/
    );
  });

  it('no geo configured at all is still a refusal', () => {
    expect(() => buildGeo({}, silentMonitor)).to.throw(/no geo lookup configured/);
  });
});

describe('an unhandled route fault is logged, not just answered (B-13)', () => {
  let server: Server | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });

  function listen(deps: EntryServerDeps): Promise<string> {
    server = serveEntryApi(deps, 0);
    return new Promise((resolve) => {
      server!.on('listening', () => {
        const { port } = server!.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      });
    });
  }

  /** A well-formed `/ciphertexts` body: past validation, into the store path. */
  const POOL = 'PooL1111111111111111111111111111111111111111';
  const PLAYER = '11111111111111111111111111111112';
  const CIPHERTEXT = Buffer.alloc(48 + 127, 7).toString('base64');

  it('records the method, the path and the error when a route throws', async () => {
    const logged: Array<[string, unknown]> = [];
    const base = await listen({
      // The pre-payment ciphertext write is the route behind this catch that
      // costs a player money: their sealed allocation failed to store, they
      // are about to pay for a pool their entry cannot be revealed in, and
      // before this fix nothing anywhere recorded why.
      packet: undefined as unknown as EntryServerDeps['packet'],
      ciphertexts: new MemoryCiphertextStore(),
      poolIds: {
        async lookup() {
          throw new Error('the pools projection is unreachable');
        },
      },
      trustProxyHeader: false,
      onServerError: (line, err) => logged.push([line, err]),
    });

    const res = await fetch(`${base}/ciphertexts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pool: POOL,
        player: PLAYER,
        ciphertext: CIPHERTEXT,
        signature: Buffer.alloc(64).toString('base64'),
      }),
    });

    // The caller still learns nothing — the entry gate's refusals are
    // generic on purpose, and this fix does not change that.
    expect(res.status).to.equal(500);
    expect(await res.json()).to.deep.equal({ error: 'internal' });

    expect(logged.length, 'the operator was told exactly once').to.equal(1);
    const [line, err] = logged[0];
    expect(line).to.contain('POST');
    expect(line).to.contain('/ciphertexts');
    expect(line).to.contain('generic 500');
    expect((err as Error).message).to.contain('unreachable');
  });

  it('says nothing on an ordinary refusal', async () => {
    const logged: string[] = [];
    const base = await listen({
      packet: undefined as unknown as EntryServerDeps['packet'],
      ciphertexts: new MemoryCiphertextStore(),
      poolIds: new MemoryPoolIdResolver(),
      trustProxyHeader: false,
      onServerError: (line) => logged.push(line),
    });
    const res = await fetch(`${base}/nothing-here`);
    expect(res.status).to.be.greaterThan(399);
    expect(logged, 'a refused request is not a fault').to.deep.equal([]);
  });
});
