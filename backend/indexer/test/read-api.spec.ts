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

  it('assembles the treasury report from raw ledger rows (D-A1 revised)', async () => {
    // Fund 10 SOL, open a tier-0 pool (pot 5.12 out), sell three passes
    // (0.3 in), then trigger the refund fork (pot back) and refund one.
    const rows = [
      { name: 'PlatformFunded', raw: { funder: 'F', amount: '10000000000', platform_balance: '10000000000' } },
      { name: 'PoolOpened', raw: { pool: POOL, id: '1', tier: 0, entry_lamports: '100000000', pot_lamports: '5120000000', fill_deadline: '0' } },
      { name: 'EntryRegistered', raw: { pool: POOL, player: 'P1', index: 0 } },
      { name: 'EntryRegistered', raw: { pool: POOL, player: 'P2', index: 1 } },
      { name: 'EntryRegistered', raw: { pool: POOL, player: 'P3', index: 2 } },
    ];
    const res = await handleRead(db(() => rows), '/treasury');
    expect(res.status).to.equal(200);
    const t = res.body as Record<string, unknown>;
    // 10 − 5.12 + 0.3 = 5.18 SOL in the treasury.
    expect(t.platform_balance_lamports).to.equal('5180000000');
    expect(t.reserved_pot_lamports).to.equal('5120000000');
    expect(t.refundable_entry_lamports).to.equal('300000000');
    const tiers = t.tiers as Array<Record<string, unknown>>;
    expect(tiers[0].status).to.equal('open');
    expect(tiers[1].status).to.equal('short'); // 25.6 SOL pot, far short
    // The floor holds the refundable 0.3 plus one pot of every idle tier.
    expect(t.withdrawable_lamports).to.equal('0');

    // The refund fork: pot returns, one player repaid.
    const rows2 = rows.concat([
      { name: 'RefundTriggered', raw: { pool: POOL, entrants: 3 } },
      { name: 'Refunded', raw: { pool: POOL, player: 'P1', amount: '100000000' } },
    ] as never);
    const t2 = (await handleRead(db(() => rows2), '/treasury')).body as Record<string, unknown>;
    // 5.18 + 5.12 (pot back) − 0.1 (one refund) = 10.2 SOL.
    expect(t2.platform_balance_lamports).to.equal('10200000000');
    expect(t2.reserved_pot_lamports).to.equal('0');
    expect(t2.refundable_entry_lamports).to.equal('200000000');
    // Tier 0's slot is still held by the Refunding pool (sequential rule).
    const tiers2 = t2.tiers as Array<Record<string, unknown>>;
    expect(tiers2[0].status).to.equal('settling');
    expect(tiers2[0].live_pool_state).to.equal('Refunding');
  });

  it('serves the player-history exhibit endpoints (D-A2 v2)', async () => {
    // W1: paid on entry 1, paid again on entry 2 (persistence).
    // W2: unpaid on entry 1, unpaid on entry 2.
    // W3: a single unpaid first-timer.
    const rows = [
      { player: 'W1', entries_to_date: '1', paid: true },
      { player: 'W1', entries_to_date: '2', paid: true },
      { player: 'W2', entries_to_date: '1', paid: false },
      { player: 'W2', entries_to_date: '2', paid: false },
      { player: 'W3', entries_to_date: '1', paid: false },
    ];
    const summary = (await handleRead(db(() => rows), '/history/summary')).body as Record<
      string,
      Record<string, string>
    >;
    expect(summary.first_time.entries).to.equal('3');
    expect(summary.first_time.paid_seat_rate_pct).to.equal('33.33');
    expect(summary.repeat.entries).to.equal('2');
    expect(summary.repeat.paid_seat_rate_pct).to.equal('50.00');

    const persistence = (await handleRead(db(() => rows), '/history/persistence'))
      .body as Record<string, Record<string, string>>;
    expect(persistence.pairs_after_paid.pairs).to.equal('1');
    expect(persistence.pairs_after_paid.paid_next_rate_pct).to.equal('100.00');
    expect(persistence.pairs_after_unpaid.pairs).to.equal('1');
    expect(persistence.pairs_after_unpaid.paid_next_rate_pct).to.equal('0.00');

    const dist = (await handleRead(db(() => rows), '/history/entries')).body as {
      wallets: string;
      entries_to_date: Array<{ entries: string; wallets: string }>;
    };
    expect(dist.wallets).to.equal('3');
    expect(dist.entries_to_date).to.deep.equal([
      { entries: '1', wallets: '1' },
      { entries: '2', wallets: '2' },
    ]);

    expect((await handleRead(db(() => []), '/history/nope')).status).to.equal(404);
  });
});

describe('read API — D3 routes', () => {
  const PLAYER = 'P1ayerAAAA111111111111111111111111111111111';

  it('serves the per-player career history rows', async () => {
    const rows = [
      {
        pool: POOL,
        pool_id: '1',
        tier: 0,
        seat: 3,
        entries_to_date: '1',
        paid: true,
        amount_lamports: '1350000000',
        pot_lamports: '5120000000',
        state: 'Paid',
      },
    ];
    const res = await handleRead(
      db((sql) => (sql.includes('FROM player_history h') ? rows : [])),
      `/profiles/${PLAYER}/history`
    );
    expect(res.status).to.equal(200);
    const body = res.body as Array<Record<string, unknown>>;
    expect(body[0].amount_lamports).to.equal('1350000000');
    expect(body[0].paid).to.equal(true);
  });

  it('serves rivals and 404s an unknown profile subroute', async () => {
    const rows = [{ player: 'R1', pools_shared: '4', paid_in_shared: '2' }];
    const res = await handleRead(
      db((sql) => (sql.includes('JOIN player_history o') ? rows : [])),
      `/profiles/${PLAYER}/rivals`
    );
    expect(res.status).to.equal(200);
    expect((res.body as unknown[]).length).to.equal(1);
    expect((await handleRead(db(() => []), `/profiles/${PLAYER}/nope`)).status).to.equal(404);
    expect((await handleRead(db(() => []), '/profiles/not-base58!/history')).status).to.equal(400);
  });

  it('sealed-entries fails CLOSED before the reveal and serves seat-keyed rows after', async () => {
    // No pool → 404.
    expect((await handleRead(db(() => []), `/pools/${POOL}/sealed-entries`)).status).to.equal(404);

    // Pool exists, secret not yet on-chain → 403, and the ciphertext query
    // is never reached (the canned db would return rows for it).
    const before = await handleRead(
      db((sql) =>
        sql.includes('SELECT id, secret')
          ? [{ id: '1', secret: null }]
          : [{ seat: 0, ciphertext_hex: 'aa' }]
      ),
      `/pools/${POOL}/sealed-entries`
    );
    expect(before.status).to.equal(403);

    // Secret revealed → anonymised seat-keyed ciphertexts.
    const after = await handleRead(
      db((sql) =>
        sql.includes('SELECT id, secret')
          ? [{ id: '1', secret: 'cc'.repeat(32) }]
          : [
              { seat: 0, ciphertext_hex: 'aa'.repeat(35) },
              { seat: 1, ciphertext_hex: 'bb'.repeat(35) },
            ]
      ),
      `/pools/${POOL}/sealed-entries`
    );
    expect(after.status).to.equal(200);
    const body = after.body as Array<Record<string, unknown>>;
    expect(body.length).to.equal(2);
    expect(body[0].seat).to.equal(0);
    expect(Object.keys(body[0])).to.not.include('player');
  });
});

describe('read API — the /pools filters (E3)', () => {
  /** Capture the SQL + params the route generates. */
  function capturing(rows: unknown[] = []) {
    const calls: Array<{ sql: string; params?: readonly unknown[] }> = [];
    const q: Queryable = {
      async query(sql: string, params?: readonly unknown[]) {
        calls.push({ sql, params });
        return { rows } as never;
      },
    };
    return { q, calls };
  }

  it('builds every filter as a bind parameter, in one WHERE clause', async () => {
    const { q, calls } = capturing();
    const res = await handleRead(q, '/pools?state=Paid&tier=2&before=50&limit=10');
    expect(res.status).to.equal(200);
    expect(calls).to.have.length(1);
    const sql = calls[0].sql.replace(/\s+/g, ' ');
    expect(sql).to.include('WHERE state = $1 AND tier = $2 AND id < $3');
    expect(sql).to.include('ORDER BY id DESC LIMIT $4');
    expect(calls[0].params).to.deep.equal(['Paid', 2, '50', 10]);
  });

  it('a bare /pools (and a stray ?) keeps the unfiltered query', async () => {
    for (const path of ['/pools', '/pools?']) {
      const { q, calls } = capturing();
      expect((await handleRead(q, path)).status).to.equal(200);
      const sql = calls[0].sql.replace(/\s+/g, ' ');
      expect(sql).to.not.include('WHERE');
      expect(calls[0].params).to.deep.equal([100]);
    }
  });

  it('rejects out-of-range or malformed filters with 400, touching no SQL', async () => {
    for (const path of [
      '/pools?state=Robbed', // not a projection state
      '/pools?tier=7', // tiers are 0..6
      '/pools?tier=x',
      '/pools?before=abc',
      '/pools?limit=0',
      '/pools?limit=101',
      '/pools?limit=ten',
    ]) {
      const { q, calls } = capturing();
      expect((await handleRead(q, path)).status).to.equal(400, path);
      expect(calls).to.have.length(0, `${path} must not reach the database`);
    }
  });
});
