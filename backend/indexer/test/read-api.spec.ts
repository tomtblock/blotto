/** Read-API routing specs over a canned Queryable — shapes, 404s, address
 * validation, and the verify-record assembly from raw ledger rows. */
import { expect } from 'chai';
import type { AddressInfo } from 'net';
import { handleRead, readFailureLine, serveReadApi } from '../src/read-api';
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
        hardOpenTiers: [false, false, false, false, false, false, false],
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

describe('read API — a read that throws (2026-10-17)', () => {
  // The database's words on 2026-10-17, when the plan quota was spent.
  const QUOTA = 'Your account or project has exceeded the quota. Upgrade your plan to increase limits.';
  const PLAYER = 'F1XTUREP1ayer111111111111111111111111111111';

  it('logs the route and the cause, never the rest of the URL', () => {
    const line = readFailureLine(`/profiles/${PLAYER}/history?limit=5`, new Error(QUOTA));
    expect(line).to.equal(`indexer: read API failed on /profiles: ${QUOTA}`);
    expect(line).not.to.contain(PLAYER);
    expect(line).not.to.contain('limit=5');
  });

  it('adds a Postgres error code, and keeps the line to one short line', () => {
    const err = Object.assign(new Error('terminating connection\nforged: line'), { code: '57P01' });
    expect(readFailureLine('/pools', err)).to.equal('indexer: read API failed on /pools [57P01]: terminating connection forged: line');
    const long = readFailureLine('/pools', new Error('x'.repeat(1000)));
    expect(long).not.to.contain('\n');
    expect(long.length).to.be.at.most('indexer: read API failed on /pools: '.length + 300);
  });

  it('does not echo a first segment that is not a plain route name', () => {
    expect(readFailureLine('/%0aFAKE LOG LINE', new Error('e'))).to.equal('indexer: read API failed on /(other): e');
    expect(readFailureLine('/', 'boom')).to.equal('indexer: read API failed on /(other): boom');
  });

  it('answers the caller "internal" and nothing more, and logs why', async () => {
    const throwing: Queryable = {
      async query() {
        throw new Error(QUOTA);
      },
    };
    const logged: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
    const server = serveReadApi(throwing, 0, undefined, { treasuryChainReader: null });
    try {
      if (!server.listening) await new Promise<void>((resolve) => server.once('listening', () => resolve()));
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/pools/${POOL}`);
      expect(res.status).to.equal(500);
      expect(await res.json()).to.deep.equal({ error: 'internal' });
      expect(logged).to.deep.equal([`indexer: read API failed on /pools: ${QUOTA}`]);
    } finally {
      console.error = original;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

/**
 * The Ladder (D-E19) on the read API: every pool row carries its OWN size,
 * floor and table, and GET /pool-types lists every pool type — chain first,
 * the `pool_types` projection when the chain read fails.
 */
describe('read API — every pool row carries its own size, floor and table (D-E19)', () => {
  const base = {
    pool: POOL,
    id: '30',
    tier: 0,
    entry_lamports: '100000000',
    fill_deadline: '4102444800',
    timer_seconds: 15,
    state: 'Open',
    sealing_pubkey: '11'.repeat(32),
    results_root: null,
    secret: null,
  };
  const one = async (row: Record<string, unknown>) =>
    (await handleRead(db(() => [row]), `/pools/${POOL}`)).body as Record<string, unknown>;

  it('serves a 16-player pool’s table, its amounts in lamports, and ITS floor', async () => {
    const row = {
      ...base,
      capacity: 16,
      min_seats: 10,
      paid_places: 4,
      prize_table: [5, 3, 1, 1],
      pot_lamports: '1000000000',
      entrants: '12',
    };
    const r = await one(row);
    expect(r).to.include({ capacity: 16, min_seats: 10, paid_places: 4 });
    expect(r.prize_table).to.deep.equal([5, 3, 1, 1]);
    // table[i] × entry, decimal strings — and they add up to the prize pool.
    expect(r.prize_amounts).to.deep.equal(['500000000', '300000000', '100000000', '100000000']);
    const sum = (r.prize_amounts as string[]).reduce((a, x) => a + BigInt(x), 0n);
    expect(sum.toString()).to.equal(row.pot_lamports);
    // 12 seated against a floor of 10: the deadline would seal it. Under the
    // old shared floor of 40 this read 'refund' — the bug a per-pool floor
    // exists to make impossible.
    expect(r.outcome_if_deadline_now).to.equal('seal');
    expect((await one({ ...row, entrants: '9' })).outcome_if_deadline_now).to.equal('refund');
    expect((await one({ ...row, entrants: '10' })).outcome_if_deadline_now).to.equal('seal');
  });

  it('judges an 8-player pool by its own floor of 5, and a full pool as sealed', async () => {
    const row = { ...base, capacity: 8, min_seats: 5, paid_places: 2, prize_table: [3, 2], pot_lamports: '500000000' };
    expect((await one({ ...row, entrants: '4' })).outcome_if_deadline_now).to.equal('refund');
    expect((await one({ ...row, entrants: '5' })).outcome_if_deadline_now).to.equal('seal');
    expect((await one({ ...row, entrants: '8', state: 'Sealed' })).outcome_if_deadline_now).to.equal('seal');
    expect((await one(row)).prize_amounts).to.deep.equal(['300000000', '200000000']);
  });

  it('serves a migrated pre-Ladder pool’s recorded floor, not a launch value', async () => {
    // `migrate_pool` restated this pool's floor as 52 (it opened before
    // R7-b): 45 seated would REFUND, whatever today's 64-player floor is.
    const row = { ...base, capacity: 64, min_seats: 52, paid_places: 1, prize_table: [40], pot_lamports: '4000000000', entrants: '45' };
    const r = await one(row);
    expect(r).to.include({ min_seats: 52, outcome_if_deadline_now: 'refund' });
    expect(r.prize_amounts).to.deep.equal(['4000000000']);
  });

  it('reads a row without the Ladder columns by the pre-Ladder rule', async () => {
    // A row projected before 0026 and not yet rederived: 64 seats, one place
    // worth the whole prize pool in whole entries, the 64-player floor.
    const r = await one({ ...base, pot_lamports: '4000000000', entrants: '40' });
    expect(r).to.include({ capacity: 64, paid_places: 1, min_seats: 40, outcome_if_deadline_now: 'seal' });
    expect(r.prize_table).to.deep.equal([40]);
    expect(r.prize_amounts).to.deep.equal(['4000000000']);
    // A prize pool that is not a whole number of entries has no table at all
    // (devnet pool #1, which never played): nothing is invented for it.
    const odd = await one({ ...base, pot_lamports: '5120000000', entrants: '0', state: 'Closed' });
    expect(odd).to.include({ capacity: 64, paid_places: 0 });
    expect(odd.prize_table).to.deep.equal([]);
    expect(odd.prize_amounts).to.deep.equal([]);
  });

  it('no amount is ever a JSON number', async () => {
    const r = await one({ ...base, capacity: 64, min_seats: 40, paid_places: 16, prize_table: [12, 6, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1], pot_lamports: '4000000000', entrants: '3' });
    for (const a of r.prize_amounts as unknown[]) expect(a).to.be.a('string').and.match(/^\d+$/);
    expect(r.prize_amounts).to.have.length(16);
  });
});

describe('read API — ?capacity= (D-E19)', () => {
  function capturing() {
    const calls: Array<{ sql: string; params?: readonly unknown[] }> = [];
    const q: Queryable = {
      async query(sql: string, params?: readonly unknown[]) {
        calls.push({ sql, params });
        return { rows: [] } as never;
      },
    };
    return { q, calls };
  }

  it('filters one pool size as a bind parameter', async () => {
    const { q, calls } = capturing();
    expect((await handleRead(q, '/pools?capacity=16&mode=hard')).status).to.equal(200);
    const sql = calls[0].sql.replace(/\s+/g, ' ');
    expect(sql).to.include('WHERE mode = $1 AND capacity = $2');
    expect(calls[0].params).to.deep.equal([1, 16, 100]);
  });

  it('refuses anything that is not one of the four sizes, touching no SQL', async () => {
    for (const path of ['/pools?capacity=12', '/pools?capacity=0', '/pools?capacity=128', '/pools?capacity=x', '/pools?capacity=016']) {
      const { q, calls } = capturing();
      expect((await handleRead(q, path)).status).to.equal(400, path);
      expect(calls).to.have.length(0, `${path} must not reach the database`);
    }
  });
});

describe('GET /pool-types — the lobby’s pool types (D-E19)', () => {
  const NOW = 1_800_000_000;
  const PRICE = 100_000_000n;
  const CAPS = [8, 16, 32, 64] as const;
  const TABLES: Record<number, number[]> = {
    8: [3, 2],
    16: [5, 3, 1, 1],
    32: [8, 4, 2, 2, 1, 1, 1, 1],
    64: [12, 6, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1],
  };
  const FLOORS: Record<number, number> = { 8: 5, 16: 10, 32: 20, 64: 40 };
  const potOf = (cap: number): bigint => TABLES[cap].reduce((a, m) => a + BigInt(m) * PRICE, 0n);
  const LIVE_ADDR = (id: number) => `Poo1Addr${id}`.padEnd(44, '1');

  /** One PoolType account as the chain reader hands it over. */
  function chainType(mode: number, cap: number, over: Record<string, unknown> = {}) {
    const table = TABLES[cap];
    return {
      mode,
      tier: 0,
      capacity: cap,
      minSeats: FLOORS[cap],
      paidPlaces: table.length,
      prizeTable: [...table, ...new Array(16 - table.length).fill(0)],
      potLamports: potOf(cap),
      enabled: true,
      activePool: 0n,
      nextOpenAt: 0n,
      bump: 255,
      address: `Type${mode}${cap}`,
      activePoolAddress: null as string | null,
      ...over,
    };
  }

  /**
   * The devnet launch: all eight 0.1 SOL pool types (both modes × four
   * sizes), tier 0 open on both ladders. Three hold a live pool, two are
   * cooling down after a pool settled, one has never run a pool, one is
   * past its cooldown and idle, and one is switched off.
   */
  function launchView(over: Record<string, unknown> = {}) {
    return {
      openTiers: [true, false, false, false, false, false, false],
      hardOpenTiers: [true, false, false, false, false, false, false],
      tierPriceLamports: [PRICE, 500_000_000n, 750_000_000n, 1_000_000_000n, 2_500_000_000n, 5_000_000_000n, 7_500_000_000n],
      poolTypes: [
        chainType(0, 8, { activePool: 40n, activePoolAddress: LIVE_ADDR(40) }), // live
        chainType(0, 16), // never ran a pool
        chainType(0, 32, { nextOpenAt: BigInt(NOW + 120) }), // cooling
        chainType(0, 64, { activePool: 41n, activePoolAddress: LIVE_ADDR(41) }), // live
        chainType(1, 8, { nextOpenAt: BigInt(NOW - 600) }), // idle, cooldown over
        chainType(1, 16, { nextOpenAt: BigInt(NOW + 300) }), // cooling
        chainType(1, 32, { activePool: 42n, activePoolAddress: LIVE_ADDR(42) }), // live
        chainType(1, 64, { enabled: false }), // switched off
      ],
      ...over,
    };
  }

  /** The `pool_types` projection, and the other ledger reads the fallback makes. */
  function ledgerDb(opts: {
    types?: Array<Record<string, unknown>>;
    live?: Array<Record<string, unknown>>;
    tiersOpened?: boolean[];
    hardTiersOpened?: boolean[];
  } = {}): Queryable {
    return db((sql, params) => {
      if (sql.includes('FROM pool_types')) return opts.types ?? [];
      if (sql.includes('FROM pools')) return opts.live ?? [];
      if (sql.includes('DISTINCT ON')) return [];
      if (sql.includes('name = $1')) {
        if (params?.[0] === 'TiersOpened' && opts.tiersOpened) return [{ raw: { open_tiers: opts.tiersOpened } }];
        if (params?.[0] === 'HardTiersOpened' && opts.hardTiersOpened) return [{ raw: { open_tiers: opts.hardTiersOpened } }];
        return [];
      }
      return [];
    });
  }

  type Body = { server_time: number; source: string; pool_types: Array<Record<string, unknown>> };
  const key = (r: Record<string, unknown>) => `${r.mode}/${r.capacity}`;

  it('lists all eight launch types from the chain, sorted mode, tier, capacity', async () => {
    const res = await handleRead(
      ledgerDb({ types: [{ mode: 1, tier: 0, capacity: 8, pool_type: 'Type18', last_pool_id: '7', prize_table: [3, 2] }] }),
      '/pool-types',
      () => NOW,
      (async () => launchView()) as never
    );
    expect(res.status).to.equal(200);
    const body = res.body as Body;
    expect(body.source).to.equal('chain');
    expect(body.server_time).to.equal(NOW);
    expect(body.pool_types.map(key)).to.deep.equal([
      'easy/8', 'easy/16', 'easy/32', 'easy/64', 'hard/8', 'hard/16', 'hard/32', 'hard/64',
    ]);

    for (const r of body.pool_types) {
      const cap = r.capacity as number;
      expect(r.tier).to.equal(0);
      expect(r.entry_lamports).to.equal(PRICE.toString());
      expect(r.prize_table, key(r)).to.deep.equal(TABLES[cap]);
      expect(r.paid_places).to.equal(cap / 4);
      expect(r.min_seats).to.equal(FLOORS[cap]);
      expect(r.prize_pool_lamports).to.equal(potOf(cap).toString());
      // Lamports per place, rank 1 first: table[i] × entry — and they sum
      // to the prize pool, at every size.
      expect(r.prize_amounts).to.deep.equal(TABLES[cap].map((m) => (BigInt(m) * PRICE).toString()));
      const sum = (r.prize_amounts as string[]).reduce((a, x) => a + BigInt(x), 0n);
      expect(sum.toString()).to.equal(r.prize_pool_lamports);
    }
  });

  it('says which types are live, which hold a pool, and which are cooling down', async () => {
    const body = (
      await handleRead(
        ledgerDb({ types: [{ mode: 1, tier: 0, capacity: 8, pool_type: 'Type18', last_pool_id: '7', prize_table: [3, 2] }] }),
        '/pool-types',
        () => NOW,
        (async () => launchView()) as never
      )
    ).body as Body;
    const row = (k: string) => body.pool_types.find((r) => key(r) === k)!;

    // `live` = tier open for the mode AND the type enabled.
    for (const k of ['easy/8', 'easy/16', 'easy/32', 'easy/64', 'hard/8', 'hard/16', 'hard/32']) {
      expect(row(k), k).to.include({ live: true, type_enabled: true, tier_open: true });
    }
    expect(row('hard/64')).to.include({ live: false, type_enabled: false, tier_open: true });

    // A live pool: its Pool PDA and id.
    expect(row('easy/8')).to.include({ live_pool: LIVE_ADDR(40), live_pool_id: 40 });
    expect(row('easy/64')).to.include({ live_pool: LIVE_ADDR(41), live_pool_id: 41 });
    expect(row('hard/32')).to.include({ live_pool: LIVE_ADDR(42), live_pool_id: 42 });
    // Idle: no pool.
    expect(row('easy/16')).to.include({ live_pool: null, live_pool_id: null });

    // The cooldown stamp, unix seconds as a number; null for a type that has
    // never settled a pool (no cooldown to wait out).
    expect(row('easy/32').next_open_at).to.equal(NOW + 120);
    expect(row('hard/16').next_open_at).to.equal(NOW + 300);
    expect(row('hard/8').next_open_at).to.equal(NOW - 600);
    expect(row('easy/16').next_open_at).to.equal(null);

    // `last_pool_id` is the ledger's (the account does not carry it).
    expect(row('hard/8').last_pool_id).to.equal(7);
    expect(row('easy/8').last_pool_id).to.equal(null);
  });

  it('a closed tier takes no entries, whatever its types’ own switches say', async () => {
    const body = (
      await handleRead(
        ledgerDb(),
        '/pool-types',
        () => NOW,
        (async () => launchView({ hardOpenTiers: [false, false, false, false, false, false, false] })) as never
      )
    ).body as Body;
    for (const r of body.pool_types.filter((x) => x.mode === 'hard')) {
      expect(r, key(r)).to.include({ tier_open: false, live: false });
    }
    expect(body.pool_types.find((r) => key(r) === 'hard/8')).to.include({ type_enabled: true });
  });

  it('falls back to the pool_types projection when the chain read fails, and says so', async () => {
    const res = await handleRead(
      ledgerDb({
        types: [
          { mode: 0, tier: 0, capacity: 8, pool_type: 'Type08', min_seats: 5, paid_places: 2, prize_table: [3, 2], pot_lamports: '500000000', enabled: true, next_open_at: '0', last_pool_id: null },
          { mode: 0, tier: 0, capacity: 64, pool_type: 'Type064', min_seats: 40, paid_places: 16, prize_table: TABLES[64], pot_lamports: '4000000000', enabled: true, next_open_at: String(NOW + 60), last_pool_id: '39' },
          { mode: 1, tier: 0, capacity: 8, pool_type: 'Type18', min_seats: 5, paid_places: 2, prize_table: [3, 2], pot_lamports: '500000000', enabled: true, next_open_at: '0', last_pool_id: null },
          // A pre-Ladder slot stamp: a row with no PoolType behind it.
          { mode: 1, tier: 0, capacity: 64, pool_type: null, min_seats: null, paid_places: null, prize_table: null, pot_lamports: null, enabled: false, next_open_at: '1700000000', last_pool_id: '5' },
        ],
        live: [{ pool: LIVE_ADDR(41), id: '41', tier: 0, mode: 0, capacity: 64, entry_lamports: '100000000', pot_lamports: '4000000000', state: 'Open', entrants: '3', refunded_count: '0' }],
        tiersOpened: [true, false, false, false, false, false, false],
      }),
      '/pool-types',
      () => NOW,
      (async () => {
        throw new Error('rpc down');
      }) as never
    );
    expect(res.status).to.equal(200);
    const body = res.body as Body;
    expect(body.source).to.equal('ledger');
    // The stamp-only row is not a pool type.
    expect(body.pool_types.map(key)).to.deep.equal(['easy/8', 'easy/64', 'hard/8']);
    const row = (k: string) => body.pool_types.find((r) => key(r) === k)!;
    expect(row('easy/64')).to.include({
      live: true,
      live_pool: LIVE_ADDR(41),
      live_pool_id: 41,
      next_open_at: NOW + 60,
      last_pool_id: 39,
      prize_pool_lamports: '4000000000',
    });
    expect(row('easy/8').prize_amounts).to.deep.equal(['300000000', '200000000']);
    // No HardTiersOpened on the ledger: the hard ladder is closed, as
    // `init_config` leaves it.
    expect(row('hard/8')).to.include({ tier_open: false, live: false, type_enabled: true });
  });

  it('with no chain reader, answers from the ledger', async () => {
    const body = (await handleRead(ledgerDb(), '/pool-types', () => NOW)).body as Body;
    expect(body).to.deep.equal({ server_time: NOW, source: 'ledger', pool_types: [] });
  });
});

describe('GET /tiers — kept for older readers, on the 64-player slot (D-E19)', () => {
  it('serves each tier’s 64-player stamp and ignores the other sizes’', async () => {
    const res = await handleRead(
      db((sql) =>
        sql.includes('FROM tier_status')
          ? [
              { tier: 0, mode: 0, capacity: 8, next_open_at: '1900', last_pool_id: '12' },
              { tier: 0, mode: 0, capacity: 64, next_open_at: '1700', last_pool_id: '9' },
            ]
          : []
      ),
      '/tiers'
    );
    const body = res.body as { tiers: Array<Record<string, unknown>> };
    expect(body.tiers[0]).to.include({ next_open_at: '1700', last_pool_id: '9' });
  });
});

describe('the verify record carries the table the chain recorded (D-E19)', () => {
  it('reads size, floor and table off PoolOpened', async () => {
    const rows = [
      {
        name: 'PoolOpened',
        raw: {
          pool: POOL,
          entry_lamports: '100000000',
          pot_lamports: '1000000000',
          sealing_secret_hash: 'aa'.repeat(32),
          capacity: 16,
          min_seats: 10,
          paid_places: 4,
          prize_table: [5, 3, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        },
      },
    ];
    const r = (await handleRead(db(() => rows), `/pools/${POOL}/verify-record`)).body as Record<string, unknown>;
    expect(r).to.include({ capacity: 16, minSeats: 10, paidPlaces: 4 });
    expect(r.prizeTable).to.deep.equal([5, 3, 1, 1]);
  });

  it('reads a pre-Ladder pool as 64 seats and one place, and takes the floor PoolMigrated states', async () => {
    const rows = [
      { name: 'PoolOpened', raw: { pool: POOL, entry_lamports: '100000000', pot_lamports: '4000000000', sealing_secret_hash: 'aa'.repeat(32), capacity: null } },
      { name: 'PoolMigrated', raw: { pool: POOL, min_seats: 40, mode: 0, capacity: 64, paid_places: 1, prize_table: [40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } },
    ];
    const r = (await handleRead(db(() => rows), `/pools/${POOL}/verify-record`)).body as Record<string, unknown>;
    expect(r).to.include({ capacity: 64, minSeats: 40, paidPlaces: 1 });
    expect(r.prizeTable).to.deep.equal([40]);
    const unmigrated = (await handleRead(db(() => rows.slice(0, 1)), `/pools/${POOL}/verify-record`)).body as Record<string, unknown>;
    expect(unmigrated).to.include({ capacity: 64, minSeats: null, paidPlaces: 1 });
    expect(unmigrated.prizeTable).to.deep.equal([40]);
  });
});
