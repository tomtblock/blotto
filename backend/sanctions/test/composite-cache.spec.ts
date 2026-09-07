import { expect } from 'chai';
import { CachingSanctionsCheck } from '../src/cache';
import { CompositeSanctionsCheck } from '../src/composite';
import { SanctionsUnavailableError, StubSanctionsCheck, type SanctionsCheck } from '../src/seam';

const failing = (msg: string): SanctionsCheck => ({
  async screen(): Promise<never> {
    throw new Error(msg);
  },
});
const at = () => new Date('2026-09-07T12:00:00Z');

describe('CompositeSanctionsCheck', () => {
  it('a match from ANY answering source lists the address; sources are named', async () => {
    const c = new CompositeSanctionsCheck(
      [
        { name: 'chainalysis', check: new StubSanctionsCheck([], at) },
        { name: 'ofac-sdn', check: new StubSanctionsCheck(['bad'], at) },
        { name: 'opensanctions', check: new StubSanctionsCheck([], at) },
      ],
      at
    );
    const v = await c.screen('bad');
    expect(v.listed).to.equal(true);
    expect(v.consulted).to.deep.equal(['chainalysis', 'ofac-sdn', 'opensanctions']);
    expect(v.failed).to.deep.equal([]);
    expect(v.matches).to.have.length(1);
    expect((await c.screen('good')).listed).to.equal(false);
  });

  it('a cross-check can add a match and never remove one', async () => {
    const c = new CompositeSanctionsCheck(
      [
        { name: 'chainalysis', check: new StubSanctionsCheck(['bad'], at) },
        { name: 'opensanctions', check: new StubSanctionsCheck([], at) },
      ],
      at
    );
    expect((await c.screen('bad')).listed).to.equal(true);
  });

  it('one failed source is DISCLOSED in `failed` and the others still decide', async () => {
    const c = new CompositeSanctionsCheck(
      [
        { name: 'chainalysis', check: failing('vendor down') },
        { name: 'ofac-sdn', check: new StubSanctionsCheck(['bad'], at) },
      ],
      at
    );
    const v = await c.screen('bad');
    expect(v.listed).to.equal(true);
    expect(v.consulted).to.deep.equal(['ofac-sdn']);
    expect(v.failed).to.deep.equal(['chainalysis']);
  });

  it('throws SanctionsUnavailableError only when EVERY source failed', async () => {
    const c = new CompositeSanctionsCheck(
      [
        { name: 'chainalysis', check: failing('a') },
        { name: 'opensanctions', check: failing('b') },
      ],
      at
    );
    try {
      await c.screen('x');
      expect.fail('should throw');
    } catch (e) {
      expect(e).to.be.instanceOf(SanctionsUnavailableError);
      expect((e as SanctionsUnavailableError).failed).to.deep.equal(['chainalysis', 'opensanctions']);
      expect((e as Error).message).to.contain('a | b');
    }
  });

  it('refuses to be built with no sources', () => {
    expect(() => new CompositeSanctionsCheck([])).to.throw(/no sources/);
  });
});

describe('CachingSanctionsCheck', () => {
  it('serves a repeat within the TTL from cache and counts it', async () => {
    let calls = 0;
    const inner: SanctionsCheck = {
      async screen(address) {
        calls++;
        return new StubSanctionsCheck([], at).screen(address);
      },
    };
    let t = 1_000_000;
    const c = new CachingSanctionsCheck(inner, { ttlMs: 60_000, now: () => t });
    await c.screen('A');
    await c.screen('A');
    expect(calls).to.equal(1);
    expect(c.hits).to.equal(1);
    expect(c.misses).to.equal(1);
    t += 60_001;
    await c.screen('A');
    expect(calls).to.equal(2);
  });

  it('never caches a failure — the next call asks again', async () => {
    let calls = 0;
    const inner: SanctionsCheck = {
      async screen(address) {
        calls++;
        if (calls === 1) throw new Error('blip');
        return new StubSanctionsCheck([], at).screen(address);
      },
    };
    const c = new CachingSanctionsCheck(inner, { now: () => 5 });
    let threw = false;
    try {
      await c.screen('A');
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
    await c.screen('A');
    expect(calls).to.equal(2);
  });

  it('keys on the address alone', async () => {
    const c = new CachingSanctionsCheck(new StubSanctionsCheck(['bad'], at), { now: () => 5 });
    expect((await c.screen('bad')).listed).to.equal(true);
    expect((await c.screen('good')).listed).to.equal(false);
  });

  it('bounds its size, evicting the oldest insertion', async () => {
    const c = new CachingSanctionsCheck(new StubSanctionsCheck([], at), {
      maxEntries: 2,
      now: () => 5,
    });
    await c.screen('a');
    await c.screen('b');
    await c.screen('c'); // evicts a
    await c.screen('a'); // miss again
    expect(c.misses).to.equal(4);
  });
});
