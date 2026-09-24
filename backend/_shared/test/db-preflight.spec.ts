/**
 * The deploy's database-url preflight (incident 2026-09-24).
 *
 * The incident these pin: a password reset at the provider, a secret still
 * holding the old one, and a deploy that checked the url was SET but never
 * that it WORKED — so it replaced the indexer's machine, watched health
 * checks fail for five minutes, and left the service down for an hour over
 * one Postgres error code.
 *
 * Offline. `inspectUrl` and `describeConnectError` are pure by construction
 * so exactly this suite can drive them; the dialling lives in
 * `check-database-url.ts` and is the one part a test here cannot reach.
 */
import { expect } from 'chai';
import { describeConnectError, inspectUrl } from '../src/db-preflight';
import { summaryLines } from '../src/check-database-url';

const REMOTE = 'postgresql://user:pw@db.example.invalid:5432/blotto';
const LOCAL = 'postgres://blotto:blotto@localhost:5432/blotto_dev';

describe('what the database url decides before anything is dialled', () => {
  it('passes a verified remote url on both clusters, saying nothing', () => {
    for (const cluster of ['devnet', 'mainnet'] as const) {
      const v = inspectUrl(`${REMOTE}?sslmode=verify-full`, cluster);
      expect(v.refusals, cluster).to.deep.equal([]);
      expect(v.warnings, cluster).to.deep.equal([]);
    }
  });

  it('REFUSES a remote url with no TLS on every cluster', () => {
    // There is no version of this product where sealed entries cross a
    // network in the clear, so devnet gets no exemption.
    for (const cluster of ['devnet', 'mainnet'] as const) {
      for (const url of [REMOTE, `${REMOTE}?sslmode=disable`]) {
        const v = inspectUrl(url, cluster);
        expect(v.refusals.length, `${cluster} ${url}`).to.equal(1);
        expect(v.refusals[0]).to.contain('in the clear');
        expect(v.refusals[0]).to.contain('sslmode=verify-full');
      }
    }
  });

  it('WARNS on an alias sslmode on devnet and REFUSES it on mainnet', () => {
    // The difference is the whole judgement: `require` is verified TLS on the
    // pinned pg 8 and unverified from pg 9, which is a dated risk worth
    // naming on devnet and one worth refusing where real money moves.
    for (const mode of ['require', 'verify-ca', 'prefer']) {
      const dev = inspectUrl(`${REMOTE}?sslmode=${mode}`, 'devnet');
      expect(dev.refusals, mode).to.deep.equal([]);
      expect(dev.warnings.length, mode).to.equal(1);
      expect(dev.warnings[0]).to.contain('pg 9');

      const main = inspectUrl(`${REMOTE}?sslmode=${mode}`, 'mainnet');
      expect(main.refusals.length, mode).to.equal(1);
      expect(main.warnings, mode).to.deep.equal([]);
      // Same sentence either way — only its severity moves with the cluster.
      expect(main.refusals[0]).to.equal(dev.warnings[0]);
    }
  });

  it('holds no TLS opinion about a developer machine, but refuses one on mainnet', () => {
    for (const url of [
      LOCAL,
      'postgres://u:p@127.0.0.1:5432/blotto',
      'postgres://u:p@postgres:5432/blotto',
      'postgres://u:p@host.docker.internal:5432/blotto',
    ]) {
      const dev = inspectUrl(url, 'devnet');
      expect(dev.refusals, url).to.deep.equal([]);
      expect(dev.warnings, url).to.deep.equal([]);

      const main = inspectUrl(url, 'mainnet');
      expect(main.refusals.length, url).to.equal(1);
      expect(main.refusals[0]).to.contain('mainnet');
    }
  });

  it('refuses an empty url rather than dialling it', () => {
    for (const url of ['', '   ']) {
      const v = inspectUrl(url, 'devnet');
      expect(v.refusals.length).to.equal(1);
      expect(v.refusals[0]).to.contain('BLOTTO_DATABASE_URL');
    }
  });
});

describe('naming a failure to connect without quoting the url back', () => {
  it('names the 2026-09-24 failure — a reset password — in its own words', () => {
    const said = describeConnectError({ code: '28P01' });
    expect(said).to.contain('28P01');
    expect(said).to.contain('password');
    // The remedy, because "invalid password" alone sends an operator to the
    // wrong end: the string was right when it was written and the database
    // moved underneath it.
    expect(said).to.contain('reset');
  });

  it('distinguishes the failures an operator would otherwise confuse', () => {
    const said = ['28P01', '28000', '3D000', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT'].map((code) =>
      describeConnectError({ code })
    );
    expect(new Set(said).size, 'each code gets its own sentence').to.equal(said.length);
  });

  it('names a TLS verification failure, which is what the verify-full edit can introduce', () => {
    for (const code of [
      'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'CERT_HAS_EXPIRED',
      'ERR_TLS_CERT_ALTNAME_INVALID',
    ]) {
      expect(describeConnectError({ code }), code).to.contain('TLS verification failed');
    }
  });

  it('NEVER repeats the driver message, for a known code or an unknown one', () => {
    // The whole url is the secret — password and host — and a driver message
    // for an unresolvable host quotes that host back. The runner masks the
    // secret it was given, not its substrings.
    const leak = 'postgresql://neondb_owner:npg_REALPASSWORD@ep-real-host.neon.tech/neondb';
    for (const err of [
      { code: '28P01', message: leak },
      { code: 'ENOTFOUND', message: leak, hostname: 'ep-real-host.neon.tech' },
      { code: 'SOME_CODE_NOBODY_HAS_SEEN', message: leak },
      new Error(leak),
      leak,
      null,
    ]) {
      const said = describeConnectError(err);
      expect(said, String(err)).to.not.contain('npg_REALPASSWORD');
      expect(said, String(err)).to.not.contain('ep-real-host');
      expect(said, String(err)).to.not.contain('neondb_owner');
    }
  });

  it('names the two failures pg reports with NO code at all', () => {
    // Measured, not assumed: `pg` 8.23.0 throws both of these as a bare
    // Error with `code === undefined`. Left to the fallback they would read
    // "the driver gave no error code", which is the least useful thing to
    // hand somebody mid-deploy — and the first of them is precisely what a
    // verify-full url meets at a database that does not serve TLS.
    const noTls = describeConnectError(new Error('The server does not support SSL connections'));
    expect(noTls).to.contain('does not offer it');
    expect(noTls).to.not.contain('no error code');

    for (const message of ['timeout expired', 'Connection terminated due to connection timeout']) {
      expect(describeConnectError(new Error(message)), message).to.contain('timed out');
    }
  });

  it('matches those messages EXACTLY, so a url-bearing message can never reach the output', () => {
    // A substring test would be the leak: "timeout expired connecting to
    // postgres://user:pw@host" contains one of these keys. Exact equality
    // cannot match a message that carries a url, because the keys carry none.
    const said = describeConnectError(
      new Error('timeout expired connecting to postgresql://neondb_owner:npg_REAL@ep-x.neon.tech/db')
    );
    expect(said).to.not.contain('npg_REAL');
    expect(said).to.contain('no error code');
  });

  it('prints an unrecognised code, which carries nothing from the url', () => {
    expect(describeConnectError({ code: 'XX000' })).to.contain('XX000');
    expect(describeConnectError(new Error('no code at all'))).to.contain('no error code');
  });
});

describe('the run summary a reader sees instead of the log', () => {
  it('says plainly whether a session opened', () => {
    const clean = summaryLines({ refusals: [], warnings: [] }, 'devnet', true).join('\n');
    expect(clean).to.contain('SELECT 1');
    expect(summaryLines({ refusals: [], warnings: [] }, 'devnet', false).join('\n')).to.contain(
      'No session was opened'
    );
  });

  it('keeps refusals and warnings under separate headings', () => {
    const out = summaryLines(
      { refusals: ['the password was rejected'], warnings: ['an alias sslmode'] },
      'devnet',
      false
    ).join('\n');
    // A warning that reads like a refusal teaches an operator to scroll past
    // refusals, which is the habit that gets a real one waved through.
    expect(out).to.contain('**This deploy was refused:**');
    expect(out).to.contain('**Worth reading, not blocking:**');
    expect(out.indexOf('refused')).to.be.lessThan(out.indexOf('not blocking'));
  });
});
