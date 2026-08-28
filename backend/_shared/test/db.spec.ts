/**
 * Pins the pool's TLS wiring (production incident, first devnet deploy
 * 2026-08-28): `pg` 8.x ignores `sslmode` inside a `connectionString`
 * passed via `PoolConfig`, so `createPool` must translate it explicitly or
 * every managed-Postgres deployment crash-loops at boot. Offline — the
 * pool is constructed, never connected.
 */
import { expect } from 'chai';
import { connectionStringWantsTls, createPool } from '../src/db';

const BASE = 'postgresql://user:pw@db.example.invalid:5432/blotto';

describe('connectionStringWantsTls', () => {
  it('recognises the TLS sslmodes', () => {
    for (const mode of ['require', 'verify-ca', 'verify-full']) {
      expect(connectionStringWantsTls(`${BASE}?sslmode=${mode}`), mode).to.equal(true);
      expect(
        connectionStringWantsTls(`${BASE}?channel_binding=require&sslmode=${mode}`),
        `${mode} as later param`
      ).to.equal(true);
    }
  });

  it('leaves plaintext URLs alone (local dev, docker compose)', () => {
    expect(connectionStringWantsTls(BASE)).to.equal(false);
    expect(connectionStringWantsTls(`${BASE}?sslmode=disable`)).to.equal(false);
    // A non-sslmode param mentioning "require" must not trip it.
    expect(connectionStringWantsTls(`${BASE}?channel_binding=require`)).to.equal(false);
  });
});

describe('createPool TLS translation', () => {
  it('enables verified TLS when the URL asks for it (the pg 8.x gap)', () => {
    const pool = createPool({ url: `${BASE}?sslmode=require`, poolMax: 2 });
    expect(pool.options.ssl).to.equal(true);
    void pool.end();
  });

  it('stays plaintext for a URL without an sslmode (local dev)', () => {
    const pool = createPool({ url: BASE, poolMax: 2 });
    expect(pool.options.ssl).to.equal(undefined);
    void pool.end();
  });
});
