/** Every branch of the selector — the precedent is `signer-selection.spec.ts`. */

import { expect } from 'chai';
import { join } from 'path';
import { CachingSanctionsCheck } from '../src/cache';
import { CompositeSanctionsCheck } from '../src/composite';
import { buildSanctions } from '../src/select';
import { StubSanctionsCheck } from '../src/seam';

const FIXTURE = join(__dirname, '../fixtures/ofac-sdn-excerpt.xml');
const quiet = () => {
  const log = console.log, warn = console.warn;
  console.log = () => undefined;
  console.warn = () => undefined;
  return () => { console.log = log; console.warn = warn; };
};

describe('buildSanctions', () => {
  let restore: () => void;
  beforeEach(() => { restore = quiet(); });
  afterEach(() => restore());

  it('nothing configured → throws naming every option', () => {
    expect(() => buildSanctions({}, 'test')).to.throw(/no sanctions screener configured/);
  });

  it('the stub requires an explicit opt-in', () => {
    expect(() => buildSanctions({ SANCTIONS_STUB_LISTED: '' }, 'test')).to.throw(/ALLOW_STUB_SANCTIONS=1/);
    const b = buildSanctions({ SANCTIONS_STUB_LISTED: '', ALLOW_STUB_SANCTIONS: '1' }, 'test');
    expect(b.check).to.be.instanceOf(StubSanctionsCheck);
    expect(b.ofac).to.equal(null);
  });

  it('the stub is configured from the env it was handed, not from process.env', async () => {
    // Regression: the first cut constructed the stub without arguments, so it
    // read process.env and ignored the list the selector had been given.
    const b = buildSanctions(
      { SANCTIONS_STUB_LISTED: ' addr-A , addr-B ', ALLOW_STUB_SANCTIONS: '1' },
      'test'
    );
    expect((await b.check.screen('addr-A')).listed).to.equal(true);
    expect((await b.check.screen('addr-B')).listed).to.equal(true);
    expect((await b.check.screen('addr-C')).listed).to.equal(false);
  });

  it('a vendor key wins over the stub even when both are set', () => {
    const b = buildSanctions(
      { SANCTIONS_CHAINALYSIS_API_KEY: 'k', SANCTIONS_STUB_LISTED: '', ALLOW_STUB_SANCTIONS: '1' },
      'test'
    );
    expect(b.check).to.be.instanceOf(CachingSanctionsCheck);
    expect(b.describe.join(' ')).to.match(/chainalysis/);
    expect(b.describe.join(' ')).to.not.match(/stub/);
  });

  it('composes every configured source and exposes the OFAC mirror for refresh', () => {
    const b = buildSanctions(
      {
        SANCTIONS_CHAINALYSIS_API_KEY: 'k1',
        SANCTIONS_OPENSANCTIONS_API_KEY: 'k2',
        SANCTIONS_OFAC_SDN: '1',
        SANCTIONS_OFAC_SDN_PATH: FIXTURE,
        SANCTIONS_CACHE_TTL_MS: '0',
      },
      'test'
    );
    expect(b.check).to.be.instanceOf(CompositeSanctionsCheck);
    expect(b.ofac).to.not.equal(null);
    expect(b.describe.join(' ')).to.match(/chainalysis.*opensanctions.*ofac-sdn.*cache DISABLED/s);
  });

  it('never prints a key — the description redacts', () => {
    const b = buildSanctions({ SANCTIONS_CHAINALYSIS_API_KEY: 'super-secret-key-value' }, 'test');
    expect(b.describe.join(' ')).to.not.contain('super-secret-key-value');
  });

  it('rejects a malformed max-age or cache TTL', () => {
    expect(() => buildSanctions({ SANCTIONS_OFAC_SDN: '1', SANCTIONS_OFAC_MAX_AGE_HOURS: '-1' }, 'test')).to.throw(/MAX_AGE_HOURS/);
    expect(() => buildSanctions({ SANCTIONS_CHAINALYSIS_API_KEY: 'k', SANCTIONS_CACHE_TTL_MS: 'soon' }, 'test')).to.throw(/CACHE_TTL_MS/);
  });
});
