/**
 * Pins the pool's survival wiring (production incident, first devnet
 * deploy 2026-08-28): pg emits 'error' on the pool for any idle client
 * that fails, and an unhandled 'error' event kills the Node process — the
 * indexer passed its deploy health checks, then crash-looped minutes
 * later when the managed Postgres dropped an idle connection. Offline —
 * the pool is constructed and prodded, never connected.
 */
import { expect } from 'chai';
import { Client, Pool } from 'pg';
import { createPool, tlsPosture, tlsWarning } from '../src/db';

const BASE = 'postgresql://user:pw@db.example.invalid:5432/blotto';

describe('createPool survival wiring', () => {
  it('attaches the REQUIRED idle-client error handler (no handler = process death)', () => {
    const pool = createPool({ url: BASE, poolMax: 2 });
    expect(pool.listenerCount('error')).to.equal(1);
    // Emitting must not throw — the handler logs and the process lives.
    expect(() => pool.emit('error', new Error('idle client lost'))).to.not.throw();
    void pool.end();
  });

  it('closes idle clients before a managed host reaps them, with keepalive on', () => {
    const pool = createPool({ url: BASE, poolMax: 2 });
    expect(pool.options.idleTimeoutMillis).to.equal(30_000);
    expect(pool.options.keepAlive).to.equal(true);
    void pool.end();
  });
});

/*
 * ── THE TLS POSTURE OF THE CONNECTION URL (2026-09-22) ────────────────────
 *
 * Written while porting a fix stranded on `step/fix-deploy-db-tls` since
 * 2026-08-28 — and the port was abandoned, because the fix's premise is
 * false on the pinned pg. The first two cases here are that measurement,
 * kept as a test so nobody re-derives it from the old commit message:
 *
 *   `pool.options.ssl` is undefined for a TLS url — which is what the
 *   original author measured — but each CLIENT parses the string itself and
 *   gets TLS anyway; and an explicit `ssl` option passed alongside a
 *   `connectionString` is IGNORED, so the stranded fix would have changed
 *   nothing in either direction.
 *
 * The rest pin the classification, because the real risk is dated rather
 * than present: `pg-connection-string` treats `require` and `verify-ca` as
 * aliases for `verify-full` TODAY and warns that it will adopt libpq's
 * weaker semantics in its next major. A url saying `require` is therefore
 * verified TLS on pg 8 and UNVERIFIED on pg 9 — arriving silently with a
 * dependency bump, on the connection carrying every sealed entry and every
 * complaint a player has written.
 */
describe('the TLS posture of a Postgres url', () => {
  const REMOTE = 'postgres://u:p@db.example.neon.tech:5432/blotto';

  it('pins what pg actually does with sslmode in a connection string', () => {
    // Measured, not assumed. If a pg bump changes either of these, this
    // test says so — and the reasoning above has to be re-read.
    const url = `${REMOTE}?sslmode=require`;
    const pool = new Pool({ connectionString: url });
    expect(pool.options.ssl, 'the POOL sees no ssl option — the red herring').to.equal(undefined);
    void pool.end().catch(() => undefined);

    const client = new Client({ connectionString: url });
    expect(client.ssl, 'the CLIENT parses the string and enables TLS').to.deep.equal({});

    // And an explicit option loses to the string, in both directions. This
    // is why no code in `db.ts` can correct a url's posture.
    const overridden = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
    expect(overridden.ssl, 'the string wins').to.deep.equal({});
  });

  it('classifies verified, alias and plaintext apart', () => {
    expect(tlsPosture(`${REMOTE}?sslmode=verify-full`)).to.equal('verified');
    // Verified today, unverified from pg 9 — the whole point of the row.
    expect(tlsPosture(`${REMOTE}?sslmode=require`)).to.equal('alias');
    expect(tlsPosture(`${REMOTE}?sslmode=verify-ca`)).to.equal('alias');
    expect(tlsPosture(`${REMOTE}?sslmode=prefer`)).to.equal('alias');
    expect(tlsPosture(`${REMOTE}?sslmode=disable`)).to.equal('plaintext');
    expect(tlsPosture(REMOTE), 'no sslmode at all').to.equal('plaintext');
    // Not confused by another parameter that merely contains the word.
    expect(tlsPosture(`${REMOTE}?application_name=sslmode-tester`)).to.equal('plaintext');
  });

  it('says nothing about a developer machine, and something about every remote', () => {
    for (const local of [
      'postgres://u:p@localhost:5432/blotto',
      'postgres://u:p@127.0.0.1:5432/blotto',
      'postgres://u:p@postgres:5432/blotto',
      'postgres://u:p@host.docker.internal:5432/blotto',
    ]) {
      expect(tlsWarning(local), local).to.equal(null);
    }
    expect(tlsWarning(`${REMOTE}?sslmode=verify-full`), 'nothing to say').to.equal(null);
  });

  it('warns DIFFERENTLY for an alias mode and for no TLS at all', () => {
    // Two different problems: one is a posture that will weaken later, the
    // other is no posture now. A single message for both would leave an
    // operator unable to tell which they have.
    const alias = tlsWarning(`${REMOTE}?sslmode=require`);
    const none = tlsWarning(REMOTE);
    expect(alias).to.be.a('string');
    expect(none).to.be.a('string');
    expect(alias).to.not.equal(none);
    expect(alias).to.contain('pg 9');
    expect(none).to.contain('in the clear');
    // Both name the one remedy, because the url is the only thing that can
    // fix it.
    expect(alias).to.contain('sslmode=verify-full');
    expect(none).to.contain('sslmode=verify-full');
  });
});
