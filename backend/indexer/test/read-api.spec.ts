/** Read-API routing specs over a canned Queryable — shapes, 404s, address
 * validation, and the verify-record assembly from raw ledger rows. */
import { expect } from 'chai';
import { handleRead } from '../src/read-api';
import type { Queryable } from '../src/shared';

const POOL = 'F1XTUREPoo1111111111111111111111111111111111';

function db(rowsFor: (sql: string, params?: readonly unknown[]) => unknown[]): Queryable {
  return {
    async query(sql: string, params?: readonly unknown[]) {
      return { rows: rowsFor(sql, params) } as never;
    },
  };
}

describe('read API routing', () => {
  it('serves the pool list and one pool with string-typed numerics', async () => {
    const row = {
      pool: POOL,
      id: '1',
      tier: 0,
      entry_lamports: '100000000',
      fill_deadline: '4102444800',
      timer_seconds: 15,
      state: 'Open',
      entrants: '23',
      sealing_pubkey: '11'.repeat(32),
      results_root: null,
      secret: null,
    };
    const res = await handleRead(db(() => [row]), '/pools');
    expect(res.status).to.equal(200);
    const body = res.body as Array<Record<string, unknown>>;
    expect(body[0].entry_lamports).to.equal('100000000');
    expect(body[0].entrants).to.equal(23);

    const one = await handleRead(db(() => [row]), `/pools/${POOL}`);
    expect(one.status).to.equal(200);
  });

  it('404s a missing pool, 400s a malformed address', async () => {
    expect((await handleRead(db(() => []), `/pools/${POOL}`)).status).to.equal(404);
    expect((await handleRead(db(() => []), '/pools/not-base58!')).status).to.equal(400);
    expect((await handleRead(db(() => []), '/nope')).status).to.equal(404);
  });

  it('assembles the verify record from raw ledger rows', async () => {
    const rows = [
      { name: 'PoolOpened', raw: { pool: POOL, entry_lamports: '100000000', sealing_secret_hash: 'aa'.repeat(32) } },
      { name: 'EntryRegistered', raw: { pool: POOL, player: 'P1', battles_hash: 'bb'.repeat(32) } },
      { name: 'PoolSecretRevealed', raw: { pool: POOL, secret: 'cc'.repeat(32) } },
      { name: 'ResultsCommitted', raw: { pool: POOL, root: 'dd'.repeat(32), payouts: [{ entry_index: 0, amount: '1350000000' }] } },
      { name: 'PrizesPaid', raw: { pool: POOL, payouts: [{ player: 'P1', entry_index: 0, amount: '1350000000', escrowed: false }] } },
    ];
    const res = await handleRead(db(() => rows), `/pools/${POOL}/verify-record`);
    expect(res.status).to.equal(200);
    const r = res.body as Record<string, unknown>;
    expect(r.revealedSecretHex).to.equal('cc'.repeat(32));
    expect(r.resultsRootHex).to.equal('dd'.repeat(32));
    expect((r.battlesHashByPlayer as Record<string, string>).P1).to.equal('bb'.repeat(32));
    expect(r.committedPayouts).to.deep.equal([{ entryIndex: 0, amount: '1350000000' }]);
    expect(r.payouts).to.deep.equal([{ player: 'P1', entryIndex: 0, amount: '1350000000' }]);
  });
});
