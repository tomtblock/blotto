/**
 * Pins the pool's survival wiring (production incident, first devnet
 * deploy 2026-08-28): pg emits 'error' on the pool for any idle client
 * that fails, and an unhandled 'error' event kills the Node process — the
 * indexer passed its deploy health checks, then crash-looped minutes
 * later when the managed Postgres dropped an idle connection. Offline —
 * the pool is constructed and prodded, never connected.
 */
import { expect } from 'chai';
import { createPool } from '../src/db';

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
