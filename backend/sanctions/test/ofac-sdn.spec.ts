/**
 * The OFAC SDN mirror, over a VERBATIM excerpt of the live SDN.XML
 * (Sanctions List Service export, 2026-09-07) — one designated entry that
 * carries a "Digital Currency Address - SOL" id among others, one plain
 * entry with no digital-currency ids, and the real document head with its
 * Publish_Date. Nothing in the fixture was typed by hand.
 */

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { join } from 'path';
import { OfacSdnMirror, parseSdnXml } from '../src/ofac-sdn';

const FIXTURE = join(__dirname, '../fixtures/ofac-sdn-excerpt.xml');
const XML = readFileSync(FIXTURE, 'utf8');
const SOL = '42RLPACwZPx3vYYmxSueqsogfynBDqXK298EDsNoyoHi';

describe('parseSdnXml — the live shape', () => {
  const parsed = parseSdnXml(XML);

  it('reads the Publish_Date and counts both entries', () => {
    expect(parsed.publishDate).to.match(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(parsed.entries).to.equal(2);
  });

  it('indexes the SOL address to its designated entity with programs and uid', () => {
    const listings = parsed.byAddress.get(SOL);
    expect(listings, 'the SOL address is indexed').to.not.equal(undefined);
    expect(listings![0].ticker).to.equal('SOL');
    expect(listings![0].uid).to.match(/^\d+$/);
    expect(listings![0].name).to.not.equal('(unnamed)');
    expect(listings![0].programs.length).to.be.greaterThan(0);
  });

  it('mirrors EVERY digital-currency ticker on the entry, not only SOL', () => {
    const tickers = new Set([...parsed.byAddress.values()].flat().map((l) => l.ticker));
    expect(tickers.has('SOL')).to.equal(true);
    expect(tickers.size).to.be.greaterThan(1);
  });

  it('ignores ids that are not digital-currency addresses', () => {
    // Passport numbers, registration ids etc. must never land in the index.
    for (const addr of parsed.byAddress.keys()) expect(addr).to.match(/^[A-Za-z0-9]+$/);
  });
});

describe('OfacSdnMirror', () => {
  const t0 = new Date('2026-09-07T12:00:00Z');

  it('refuses to answer before refresh()', async () => {
    let threw = false;
    try {
      await new OfacSdnMirror({ path: FIXTURE }).screen(SOL);
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
  });

  it('lists the SOL address and clears an unknown one after loading the fixture', async () => {
    const m = new OfacSdnMirror({ path: FIXTURE, now: () => t0 });
    const snap = await m.refresh();
    expect(snap.entries).to.equal(2);
    expect(snap.addresses).to.be.greaterThan(0);
    const hit = await m.screen(SOL);
    expect(hit.listed).to.equal(true);
    expect(hit.matches[0].source).to.equal('ofac-sdn');
    expect(hit.consulted).to.deep.equal(['ofac-sdn']);
    expect((await m.screen('11111111111111111111111111111111')).listed).to.equal(false);
  });

  it('a STALE mirror throws instead of answering clean', async () => {
    let now = t0;
    const m = new OfacSdnMirror({ path: FIXTURE, now: () => now, maxAgeMs: 3_600_000 });
    await m.refresh();
    now = new Date(t0.getTime() + 3_600_001);
    let threw = false;
    try {
      await m.screen('anything');
    } catch (e) {
      threw = /stale/.test((e as Error).message);
    }
    expect(threw).to.equal(true);
  });

  it('a failed refresh keeps the last good set', async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      if (calls === 1) return { ok: true, status: 200, text: async () => XML } as unknown as Response;
      throw new Error('treasury host down');
    }) as unknown as typeof fetch;
    const m = new OfacSdnMirror({ url: 'https://example.invalid/SDN.XML', fetchImpl: f, now: () => t0 });
    await m.refresh();
    expect(m.status()!.entries).to.equal(2);
    let threw = false;
    try {
      await m.refresh();
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
    // Property 2: nothing was cleared; the mirror still answers from the good set.
    expect(m.status()!.entries).to.equal(2);
    expect((await m.screen(SOL)).listed).to.equal(true);
  });

  it('a document with no <sdnEntry> is rejected as not-the-list', async () => {
    const m = new OfacSdnMirror({
      url: 'https://example.invalid/SDN.XML',
      fetchImpl: (async () => ({ ok: true, status: 200, text: async () => '<html>maintenance</html>' })) as unknown as typeof fetch,
    });
    let threw = false;
    try {
      await m.refresh();
    } catch (e) {
      threw = /no <sdnEntry>/.test((e as Error).message);
    }
    expect(threw).to.equal(true);
  });
});
