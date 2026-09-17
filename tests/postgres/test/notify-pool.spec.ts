/**
 * The v2 opt-in store and the pool-state reader against real Postgres
 * (round four, 2026-09-17): the upsert reopens, `pending` excludes what has
 * gone, and `markSent` drops the address in the same statement — the
 * property the migration's comment promises.
 */
import { expect } from 'chai';
import type { Pool } from 'pg';

import { base58Encode } from '../../../backend/_shared/src/blotto-events';
import { PgPoolNotifyStore, PgPoolStateReader } from '../../../backend/packet/src/stores-pg';
import { CONFIGURED, truncate } from '../src/db';
import { sharedDatabase } from '../src/schema';

function keyFor(fill: number): string {
  const b = new Uint8Array(32);
  b.fill(fill);
  return base58Encode(b);
}

const POOL_A = keyFor(11);
const POOL_B = keyFor(12);
const WALLET = keyFor(21);

(CONFIGURED ? describe : describe.skip)('notify v2 on Postgres', () => {
  let pool: Pool;
  before(async () => {
    ({ pool } = await sharedDatabase());
  });
  beforeEach(async () => {
    await truncate(pool, ['notify_pool_optin', 'pools']);
  });

  it('put, get, pending, markSent — and a replacement reopens a sent row', async () => {
    const store = new PgPoolNotifyStore(pool);
    await store.put({ pool: POOL_A, wallet: WALLET, email: 'tom@example.com', timestamp: 1_758_000_000n, walletSignature: 'c2ln', sentAt: null });
    const rec = await store.get(POOL_A, WALLET);
    expect(rec?.email).to.equal('tom@example.com');
    expect(rec?.timestamp).to.equal(1_758_000_000n);
    expect(rec?.sentAt).to.equal(null);
    expect((await store.pending()).map((r) => r.pool)).to.deep.equal([POOL_A]);

    await store.markSent(POOL_A, WALLET, new Date('2026-09-17T03:00:00Z'));
    const sent = await store.get(POOL_A, WALLET);
    expect(sent?.email).to.equal(null);
    expect(sent?.sentAt?.toISOString()).to.equal('2026-09-17T03:00:00.000Z');
    expect(await store.pending()).to.deep.equal([]);

    await store.put({ pool: POOL_A, wallet: WALLET, email: 'again@example.com', timestamp: 1_758_000_100n, walletSignature: 'c2ln', sentAt: null });
    const reopened = await store.get(POOL_A, WALLET);
    expect(reopened?.email).to.equal('again@example.com');
    expect(reopened?.sentAt).to.equal(null);
    expect((await store.pending()).length).to.equal(1);
  });

  it('the state reader answers the pools it knows, with their numbers', async () => {
    await pool.query(`INSERT INTO pools (pool, id, state) VALUES ($1, 16, 'Paid'), ($2, 17, 'Open')`, [POOL_A, POOL_B]);
    const reader = new PgPoolStateReader(pool);
    const states = await reader.states([POOL_A, POOL_B, keyFor(99)]);
    expect(states.get(POOL_A)).to.deep.equal({ id: '16', state: 'Paid' });
    expect(states.get(POOL_B)).to.deep.equal({ id: '17', state: 'Open' });
    expect(states.has(keyFor(99))).to.equal(false);
    expect((await reader.states([])).size).to.equal(0);
  });
});
