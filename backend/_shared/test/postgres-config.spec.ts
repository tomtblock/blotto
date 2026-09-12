/**
 * The shared Postgres block refuses to start unconfigured (audit
 * 2026-09-11, Tier 3 item 6). Until 2026-09-12 an unset BLOTTO_DATABASE_URL
 * silently became the local-dev connection string.
 */

import { expect } from 'chai';
import { DEFAULT_DATABASE_URL, POSTGRES_ENV, loadPostgresConfig } from '../src/config';

describe('loadPostgresConfig', () => {
  it('throws when the URL is unset, naming the variable and the local-dev value to copy', () => {
    for (const env of [{}, { [POSTGRES_ENV.url]: '' }, { [POSTGRES_ENV.url]: '   ' }]) {
      expect(() => loadPostgresConfig(env)).to.throw(POSTGRES_ENV.url);
      expect(() => loadPostgresConfig(env)).to.throw(DEFAULT_DATABASE_URL);
    }
  });

  it('never substitutes the local-dev string on its own', () => {
    const url = 'postgres://real:real@db.example.internal:5432/blotto';
    const cfg = loadPostgresConfig({ [POSTGRES_ENV.url]: url });
    expect(cfg.url).to.equal(url);
    expect(cfg.poolMax).to.equal(10);
  });
});
