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
    // Stage C: the derived fields are always present, defaulting closed.
    expect(body[0].held_shares).to.equal(0);
    expect(body[0].resolving).to.equal(false);
    expect(body[0].resolving_until).to.equal(null);

    const one = await handleRead(db(() => [row]), `/pools/${POOL}`);
    expect(one.status).to.equal(200);
  });

  it('derives "resolving" from held shares and the published window (Stage C)', async () => {
    // A pool the indexer saw settle at t=1000 with one share still held.
    const base = {
      pool: POOL, id: '9', tier: 0, entry_lamports: '100000000', fill_deadline: '0',
      timer_seconds: 15, state: 'Paid', entrants: '64', sealing_pubkey: '11'.repeat(32),
      results_root: 'dd'.repeat(32), secret: 'cc'.repeat(32),
    };
    const held = { ...base, held_shares: 1, settled_at: '1000' };
    const inside = (await handleRead(db(() => [held]), `/pools/${POOL}`, () => 1000 + 11 * 3600))
      .body as Record<string, unknown>;
    expect(inside.held_shares).to.equal(1);
    expect(inside.resolving).to.equal(true);
    expect(inside.resolving_until).to.equal(String(1000 + 12 * 3600));
    expect(inside.server_time).to.equal(String(1000 + 11 * 3600));

    // The window closes at exactly twelve hours — not resolving from then on,
    // however many shares are still held (that is the daemon's failure to
    // show, not a state to hide behind).
    const atClose = (await handleRead(db(() => [held]), `/pools/${POOL}`, () => 1000 + 12 * 3600))
      .body as Record<string, unknown>;
    expect(atClose.resolving).to.equal(false);
    expect(atClose.held_shares).to.equal(1);

    // Every share decided → not resolving, even inside the window.
    const decided = { ...base, held_shares: 0, settled_at: '1000' };
    const r = (await handleRead(db(() => [decided]), `/pools/${POOL}`, () => 1000 + 60)).body as Record<string, unknown>;
    expect(r.resolving).to.equal(false);
    expect(r.resolving_until).to.equal(String(1000 + 12 * 3600));

    // Never settled (Open, or a row from before this column existed) → no window at all.
    const open = { ...base, state: 'Open' };
    const o = (await handleRead(db(() => [open]), `/pools/${POOL}`, () => 5)).body as Record<string, unknown>;
    expect(o.held_shares).to.equal(0);
    expect(o.resolving).to.equal(false);
    expect(o.resolving_until).to.equal(null);
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
      { name: 'ResultsCommitted', raw: { pool: POOL, root: 'dd'.repeat(32), payouts: [{ entry_index: 0, amount: '4000000000' }] } },
      { name: 'PrizesPaid', raw: { pool: POOL, payouts: [{ player: 'P1', entry_index: 0, amount: '4000000000', escrowed: false }] } },
    ];
    const res = await handleRead(db(() => rows), `/pools/${POOL}/verify-record`);
    expect(res.status).to.equal(200);
    const r = res.body as Record<string, unknown>;
    expect(r.revealedSecretHex).to.equal('cc'.repeat(32));
    expect(r.resultsRootHex).to.equal('dd'.repeat(32));
    expect((r.battlesHashByPlayer as Record<string, string>).P1).to.equal('bb'.repeat(32));
    expect(r.committedPayouts).to.deep.equal([{ entryIndex: 0, amount: '4000000000' }]);
    expect(r.payouts).to.deep.equal([{ player: 'P1', entryIndex: 0, amount: '4000000000' }]);
  });

  // The treasury report's own specs live in treasury-report.spec.ts: since
  // 2026-09-12 it reads the derived `pools` table and three bounded ledger
  // lookups rather than one canned row set, so a double that answers every
  // statement with the same rows cannot drive it (audit B-18 / D-18).

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
        amount_lamports: '4000000000',
        pot_lamports: '4000000000',
        state: 'Paid',
      },
    ];
    const res = await handleRead(
      db((sql) => (sql.includes('FROM player_history h') ? rows : [])),
      `/profiles/${PLAYER}/history`
    );
    expect(res.status).to.equal(200);
    const body = res.body as Array<Record<string, unknown>>;
    expect(body[0].amount_lamports).to.equal('4000000000');
    expect(body[0].paid).to.equal(true);
  });

  it('the rivals route is gone (2026-09-16); unknown profile subroutes still 404, bad players 400', async () => {
    // Rewritten in place under the founder's data-minimisation ruling of
    // 2026-09-15: this case used to assert that `/rivals` served the eight
    // most-shared co-entrants. Nothing in scoring, payment or verification
    // needed that graph, so the route no longer exists — and, as before, no
    // query is issued for a subroute the API does not know.
    const issued: string[] = [];
    const res = await handleRead(
      db((sql) => {
        issued.push(sql);
        return [{ player: 'R1', pools_shared: '4', paid_in_shared: '2' }];
      }),
      `/profiles/${PLAYER}/rivals`
    );
    expect(res.status).to.equal(404);
    expect(issued, 'no co-entrant query is issued any more').to.deep.equal([]);
    expect((await handleRead(db(() => []), `/profiles/${PLAYER}/nope`)).status).to.equal(404);
    expect((await handleRead(db(() => []), '/profiles/not-base58!/history')).status).to.equal(400);
  });

  it('the sealed boxes have NO public reader: sealed-entries is gone before and after the reveal', async () => {
    // Rewritten in place on 2026-09-16 (the founder's data-minimisation
    // ruling of 2026-09-15). This case used to prove the route failed closed
    // before the reveal and served seat-keyed ciphertexts after it. The
    // boxes still carry the per-screen timings and the device marker that
    // bundle version 2 (audit B-31) keeps out of the published set, so
    // serving them after reveal published both anyway. Now nothing serves a
    // box, revealed or not, and no sealed_entries query is ever issued.
    const issued: string[] = [];
    const canned = (secret: string | null) =>
      db((sql) => {
        issued.push(sql);
        return sql.includes('SELECT id, secret')
          ? [{ id: '1', secret }]
          : [{ seat: 0, ciphertext_hex: 'aa'.repeat(35) }];
      });
    expect((await handleRead(canned(null), `/pools/${POOL}/sealed-entries`)).status).to.equal(404);
    expect((await handleRead(canned('cc'.repeat(32)), `/pools/${POOL}/sealed-entries`)).status).to.equal(
      404
    );
    expect(issued.filter((sql) => /sealed_entries/i.test(sql))).to.deep.equal([]);
  });

  it('serves the entry rows by NAMED columns, never SELECT * (2026-09-16)', async () => {
    // Every column named here is an on-chain fact; a column added to the
    // table later is not served until someone adds it to the list.
    const issued: string[] = [];
    const res = await handleRead(
      db((sql) => {
        issued.push(sql);
        return [{ pool: POOL, player: PLAYER, idx: 0, flagged: false, sanctions_hold: false }];
      }),
      `/pools/${POOL}/entries`
    );
    expect(res.status).to.equal(200);
    expect(issued.length).to.equal(1);
    expect(issued[0]).to.not.match(/SELECT\s+\*/i);
    for (const column of [
      'pool',
      'player',
      'idx',
      'battles_hash',
      'class',
      'slot_hash',
      'pass_asset',
      'flagged',
      'refunded',
      'escrow_settled',
      'terms_version',
      'next_place_lamports',
      'sanctions_hold',
      'sanctions_hold_at',
    ]) {
      expect(issued[0], `names ${column}`).to.match(new RegExp(`\\b${column}\\b`));
    }
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
    // Stage C: the held-share and settled-at subqueries ride in the SAME
    // statement — one round trip per page, not one per pool.
    expect(sql).to.include('AS held_shares');
    expect(sql).to.include("ev.name = 'PrizesPaid'");
    expect(calls[0].params).to.deep.equal(['Paid', 2, '50', 10]);
  });

  it('a bare /pools (and a stray ?) keeps the unfiltered query', async () => {
    for (const path of ['/pools', '/pools?']) {
      const { q, calls } = capturing();
      expect((await handleRead(q, path)).status).to.equal(200);
      const sql = calls[0].sql.replace(/\s+/g, ' ');
      // No OUTER filter: the statement goes straight from the pools table
      // to the ordering. (The Stage C subqueries carry their own WHEREs.)
      expect(sql).to.include('FROM pools p ORDER BY id DESC LIMIT $1');
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

/**
 * GET /tiers — enablement (founder instruction 2026-09-12 §2.3).
 *
 * The route used to serve cooldown stamps only, for whichever tiers had
 * settled a pool. No route the app could reach published `open_tiers` at
 * all, so the landing page carried its own `LAUNCH_TIER = 0` constant and
 * `set_open_tiers` could not move the site. These pin the shape that
 * replaced it.
 */
describe('GET /tiers — which tiers may open a pool', () => {
  /** A `Queryable` that answers the two queries the route makes. */
  function tiersDb(opts: {
    status?: Array<{ tier: number; next_open_at: string; last_pool_id: string | null }>;
    tiersOpened?: boolean[] | null;
  }): Queryable {
    return db((sql) => {
      if (sql.includes('FROM tier_status')) return opts.status ?? [];
      if (sql.includes("name = $1")) {
        return opts.tiersOpened ? [{ raw: { open_tiers: opts.tiersOpened } }] : [];
      }
      return [];
    });
  }

  it('serves a row per CONFIGURED tier, not per tier that has settled a pool', async () => {
    // Only tier 0 has ever run one; the other six must still appear, marked
    // closed, or the app cannot tell "closed" from "not in the response".
    const res = await handleRead(
      tiersDb({ status: [{ tier: 0, next_open_at: '1700', last_pool_id: '9' }] }),
      '/tiers'
    );
    expect(res.status).to.equal(200);
    const body = res.body as { tiers: Array<Record<string, unknown>>; enablement_source: string };
    expect(body.tiers).to.have.length(7);
    expect(body.tiers.map((t) => t.tier)).to.deep.equal([0, 1, 2, 3, 4, 5, 6]);
    // Tier 0's stamp survives; the rest report a zero stamp and no pool.
    expect(body.tiers[0]).to.include({ next_open_at: '1700', last_pool_id: '9' });
    expect(body.tiers[3]).to.include({ next_open_at: '0', last_pool_id: null });
  });

  it('falls back to init_config’s posture when the founder has never sent set_open_tiers', async () => {
    const res = await handleRead(tiersDb({}), '/tiers');
    const body = res.body as { tiers: Array<Record<string, unknown>>; enablement_source: string };
    expect(body.enablement_source).to.equal('launch_default');
    expect(body.tiers[0]).to.include({ enabled: true, status: 'open' });
    for (const t of body.tiers.slice(1)) expect(t).to.include({ enabled: false, status: 'closed' });
  });

  it('follows the newest TiersOpened event when there is one', async () => {
    const res = await handleRead(
      tiersDb({ tiersOpened: [true, true, false, false, false, false, false] }),
      '/tiers'
    );
    const body = res.body as { tiers: Array<Record<string, unknown>>; enablement_source: string };
    expect(body.enablement_source).to.equal('ledger');
    expect(body.tiers[1]).to.include({ enabled: true, status: 'open' });
    expect(body.tiers[2]).to.include({ enabled: false, status: 'closed' });
  });

  it('prefers the live Config account over the ledger, and says so', async () => {
    // The ledger's newest event says tiers 0 and 1; the account says tier 0
    // alone. The account wins — a `set_open_tiers` the indexer has not yet
    // ingested must not leave a closed tier showing as open.
    const chain = async () =>
      ({
        openTiers: [true, false, false, false, false, false, false],
      }) as never;
    const res = await handleRead(
      tiersDb({ tiersOpened: [true, true, false, false, false, false, false] }),
      '/tiers',
      undefined,
      chain
    );
    const body = res.body as { tiers: Array<Record<string, unknown>>; enablement_source: string };
    expect(body.enablement_source).to.equal('chain');
    expect(body.tiers[1]).to.include({ enabled: false, status: 'closed' });
  });

  it('degrades to the ledger rather than failing when the chain read throws', async () => {
    const chain = async () => {
      throw new Error('rpc down');
    };
    const res = await handleRead(
      tiersDb({ tiersOpened: [true, true, false, false, false, false, false] }),
      '/tiers',
      undefined,
      chain
    );
    expect(res.status).to.equal(200);
    const body = res.body as { enablement_source: string };
    expect(body.enablement_source).to.equal('ledger');
  });
});
