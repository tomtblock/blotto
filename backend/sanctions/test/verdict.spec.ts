/**
 * The property this package exists for: a verdict carries list membership
 * and NEVER a risk score, and the one decision reads nothing but `listed`.
 */

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  asSanctionsList,
  isListed,
  StubSanctionsCheck,
  type SanctionsVerdict,
} from '../src/seam';

const clean: SanctionsVerdict = {
  address: 'A',
  listed: false,
  matches: [],
  consulted: ['stub'],
  failed: [],
  checkedAt: '2026-09-07T00:00:00.000Z',
};

describe('the verdict type carries no score', () => {
  it('has exactly the six documented fields and none of them is a number', () => {
    expect(Object.keys(clean).sort()).to.deep.equal(
      ['address', 'checkedAt', 'consulted', 'failed', 'listed', 'matches'].sort()
    );
    for (const v of Object.values(clean)) expect(typeof v).to.not.equal('number');
  });

  it('the source declares no score-like field anywhere', () => {
    // Structural, over the source text: a future `score`, `risk`, `exposure`
    // or `confidence` field on the verdict or a match must be a deliberate,
    // reviewed change — not something that arrives with a vendor upgrade.
    const src = readFileSync(join(__dirname, '../src/seam.ts'), 'utf8');
    const typeBlocks = src.match(/export interface Sanctions(Verdict|Match)[\s\S]*?\n}/g) ?? [];
    expect(typeBlocks.length).to.equal(2);
    for (const block of typeBlocks) {
      expect(block).to.not.match(/\b(score|risk|exposure|confidence)\b\s*[?]?:/i);
    }
  });
});

describe('isListed — the one decision', () => {
  it('pays when listed is false even if every score-like field a vendor could return is present', () => {
    const decorated = {
      ...clean,
      score: 1.0,
      riskScore: 100,
      risk: 'SEVERE',
      exposure: 'direct',
      confidence: 0.999,
    } as unknown as SanctionsVerdict;
    expect(isListed(decorated)).to.equal(false);
  });

  it('withholds when listed is true even with a zero score attached', () => {
    const decorated = { ...clean, listed: true, score: 0 } as unknown as SanctionsVerdict;
    expect(isListed(decorated)).to.equal(true);
  });

  it('treats anything but the boolean true as not listed', () => {
    for (const v of [undefined, null, 0, 1, 'true']) {
      expect(isListed({ ...clean, listed: v as unknown as boolean })).to.equal(false);
    }
  });
});

describe('the stub', () => {
  const orig = process.env.SANCTIONS_STUB_LISTED;
  afterEach(() => {
    if (orig === undefined) delete process.env.SANCTIONS_STUB_LISTED;
    else process.env.SANCTIONS_STUB_LISTED = orig;
  });

  it('throws when unconfigured — an unconfigured stub must block, not admit', async () => {
    delete process.env.SANCTIONS_STUB_LISTED;
    let threw = false;
    try {
      await new StubSanctionsCheck().screen('A');
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
  });

  it('an EMPTY env list is a valid configuration meaning nobody is listed', async () => {
    process.env.SANCTIONS_STUB_LISTED = '';
    const v = await new StubSanctionsCheck().screen('A');
    expect(v.listed).to.equal(false);
    expect(v.consulted).to.deep.equal(['stub']);
  });

  it('lists exactly the configured addresses', async () => {
    const s = new StubSanctionsCheck(['bad1', 'bad2'], () => new Date(0));
    expect((await s.screen('bad2')).listed).to.equal(true);
    expect((await s.screen('bad2')).matches[0].source).to.equal('stub');
    expect((await s.screen('good')).listed).to.equal(false);
    expect((await s.screen('good')).checkedAt).to.equal('1970-01-01T00:00:00.000Z');
  });
});

describe('asSanctionsList — the packet service view', () => {
  it('is the boolean the packet seam expects, and ignores country', async () => {
    const list = asSanctionsList(new StubSanctionsCheck(['bad']));
    expect(await list.isSanctioned('bad', 'GB')).to.equal(true);
    expect(await list.isSanctioned('bad', 'US')).to.equal(true);
    expect(await list.isSanctioned('good', 'GB')).to.equal(false);
  });

  it('propagates a throw — the packet service folds it into the generic rejection', async () => {
    delete process.env.SANCTIONS_STUB_LISTED;
    const list = asSanctionsList(new StubSanctionsCheck());
    let threw = false;
    try {
      await list.isSanctioned('x', 'GB');
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
  });
});
