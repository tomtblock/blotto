/**
 * The archive ingest against a REAL transaction (audit 2026-09-11, B-20 /
 * F-05 — and the reason this whole package exists).
 *
 * THE DEFECT, AND WHY NOTHING CAUGHT IT. `ingestBundle` replaces a pool's
 * served rankings and then vouches for them. It used to issue four kinds of
 * statement — the attempt row, a wholesale DELETE, N inserts, and the
 * vouching flag — each on its own autocommitted round trip, with the flag
 * FIRST. A crash after the DELETE left an empty leaderboard still marked
 * verified; a reader arriving between the flag and the last insert saw a
 * truncated field presented as a whole result. The fix groups the writes in
 * one `atomically` and writes the flag last.
 *
 * `backend/indexer/test/archive.spec.ts` pins that offline, against a
 * `MemDb` whose `atomically` snapshots two JavaScript Maps and restores them
 * on a throw. That double proves the ingest CALLS the grouping. It cannot
 * prove the grouping is a transaction: the double IS the transaction, so a
 * regression that swapped `atomicDb()` for a pool-per-statement handle would
 * leave it green. Here `atomicDb(pool)` is the real thing and the rollback
 * is Postgres's.
 *
 * Two properties, separately:
 *
 *   1. ATOMICITY — a failure part-way leaves the previous verified answer
 *      whole, not an empty one still flagged true (B-20);
 *   2. ISOLATION — a concurrent reader on ANOTHER connection never observes
 *      the half-written state, which is the stronger form of "the flag is
 *      written last" (F-05).
 */
import { expect } from 'chai';
import type { Pool } from 'pg';

import { leafBytes, merkleRoot } from '../../../backend/scoring/src/merkle';
import { base58Decode, base58Encode } from '../../../backend/indexer/src/shared';
import type { Queryable } from '../../../backend/indexer/src/shared';
import { atomicDb, type AtomicDb } from '../../../backend/indexer/src/atomic';
import {
  backfillArchive,
  discoverBundleUri,
  ingestBundle,
  type BundleResultRow,
} from '../../../backend/indexer/src/archive';
import { handleRead } from '../../../backend/indexer/src/read-api';
import { CONFIGURED, truncate } from '../src/db';
import { sharedDatabase } from '../src/schema';

const POOL = 'F1XTUREPoo1111111111111111111111111111111111';

/** A deterministic 32-byte player key per seat, base58 like production. */
function playerB58(seat: number): string {
  const b = new Uint8Array(32);
  b.fill(7);
  b[0] = 1 + seat;
  return base58Encode(b);
}

/** A small, valid results set in leaf order (rank asc, seat asc). */
function makeResults(): BundleResultRow[] {
  return [
    { index: 2, player: playerB58(2), score_half: 20, zones: 5, rank: 1, amount_lamports: '4000000000' },
    { index: 0, player: playerB58(0), score_half: 12, zones: 3, rank: 2, amount_lamports: '0' },
    { index: 1, player: playerB58(1), score_half: 4, zones: 1, rank: 3, amount_lamports: '0' },
  ];
}

/** The root the crank would commit for these rows — same functions, same bytes. */
function rootOf(results: readonly BundleResultRow[]): string {
  return Buffer.from(
    merkleRoot(
      results.map((r) =>
        leafBytes({
          player: base58Decode(r.player),
          rank: r.rank,
          amountLamports: BigInt(r.amount_lamports),
        })
      )
    )
  ).toString('hex');
}

/** Injected fetch serving canned JSON bodies by exact URI. */
function fakeFetch(byUri: Record<string, unknown>): typeof fetch {
  return (async (input: unknown) => {
    const uri = String(input);
    if (uri in byUri) {
      return { ok: true, status: 200, json: async () => byUri[uri] } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' } as Response;
  }) as typeof fetch;
}

/**
 * The real `AtomicDb`, with a hook on the statements issued INSIDE the
 * transaction. `onStatement` may throw (to force a rollback) or await (to
 * hold the transaction open while another connection reads).
 */
function instrumented(
  pool: Pool,
  onStatement: (sql: string) => Promise<void>
): AtomicDb {
  const real = atomicDb(pool);
  return {
    query: real.query,
    atomically: (fn) =>
      real.atomically(async (q: Queryable) => {
        const watched: Queryable = {
          async query(text: string, params?: readonly unknown[]) {
            await onStatement(text.replace(/\s+/g, ' ').trim());
            return q.query(text, params);
          },
        };
        return fn(watched);
      }),
  };
}

(CONFIGURED ? describe : describe.skip)('the archive ingest, against a real transaction', function () {
  this.timeout(60_000);

  let pool: Pool;
  let db: AtomicDb;
  const results = makeResults();
  const uri = 'https://gw/bundle1';

  before(async () => {
    pool = (await sharedDatabase()).pool;
    db = atomicDb(pool);
  });

  beforeEach(async () => {
    await truncate(pool, ['pools', 'entries', 'rankings', 'bundles', 'published_bundles']);
    await pool.query(
      `INSERT INTO pools (pool, id, tier, state, entrants, results_root)
       VALUES ($1, '1', 0, 'Paid', 3, $2)`,
      [POOL, rootOf(results)]
    );
    for (const seat of [0, 1, 2]) {
      await pool.query('INSERT INTO entries (pool, player, idx) VALUES ($1, $2, $3)', [
        POOL,
        playerB58(seat),
        seat,
      ]);
    }
  });

  async function servedRows(): Promise<Array<Record<string, unknown>>> {
    const res = await pool.query(
      'SELECT player, seat, rank, amount_lamports::text AS amount_lamports FROM rankings WHERE pool = $1 ORDER BY rank',
      [POOL]
    );
    return res.rows as Array<Record<string, unknown>>;
  }

  async function flag(): Promise<boolean | null> {
    const res = await pool.query('SELECT root_matches FROM bundles WHERE pool = $1', [POOL]);
    return res.rows.length === 0 ? null : (res.rows[0] as { root_matches: boolean }).root_matches;
  }

  it('persists a verified bundle and takes each seat from our own entry projection', async () => {
    const out = await ingestBundle(db, POOL, uri, fakeFetch({ [uri]: { pool_id: '1', results } }));
    expect(out.ok, out.reason).to.equal(true);
    expect(out.rows).to.equal(3);
    expect(out.seatsUnresolved).to.equal(0);
    expect(await flag()).to.equal(true);
    expect(await servedRows()).to.deep.equal([
      { player: playerB58(2), seat: 2, rank: 1, amount_lamports: '4000000000' },
      { player: playerB58(0), seat: 0, rank: 2, amount_lamports: '0' },
      { player: playerB58(1), seat: 1, rank: 3, amount_lamports: '0' },
    ]);
  });

  it('a failure part-way leaves the previous verified answer whole (B-20)', async () => {
    await ingestBundle(db, POOL, uri, fakeFetch({ [uri]: { pool_id: '1', results } }));
    const before = await servedRows();
    expect(before.length).to.equal(3);

    // Fail on the SECOND ranking insert — after the DELETE has removed every
    // served row and after one replacement has landed. This is precisely the
    // moment the old code left an empty, verified leaderboard behind.
    let inserts = 0;
    const failing = instrumented(pool, async (sql) => {
      if (sql.startsWith('INSERT INTO rankings') && ++inserts === 2) {
        throw new Error('injected failure mid-write');
      }
    });
    let threw: Error | null = null;
    try {
      await ingestBundle(failing, POOL, uri, fakeFetch({ [uri]: { pool_id: '1', results } }));
    } catch (e) {
      threw = e as Error;
    }
    expect(threw, 'the failure must surface, not be swallowed').to.not.equal(null);

    expect(await servedRows(), 'yesterday`s verified answer must still be whole').to.deep.equal(
      before
    );
    expect(await flag(), 'and must still be flagged verified').to.equal(true);
    // And it is still SERVED — the property a player experiences.
    const served = await handleRead(pool, `/pools/${POOL}/leaderboard`);
    expect(served.status).to.equal(200);
    expect((served.body as { rows: unknown[] }).rows.length).to.equal(3);
  });

  it('no other connection ever sees the half-written state (F-05)', async () => {
    await ingestBundle(db, POOL, uri, fakeFetch({ [uri]: { pool_id: '1', results } }));
    const before = await servedRows();

    // A second bundle for the same pool: same players, different amounts, a
    // root the chain now commits. While the replacement is mid-flight, a
    // reader on ANOTHER connection asks the read API for the leaderboard.
    const replacement = results.map((r, i) => ({ ...r, amount_lamports: i === 0 ? '3000000000' : '500000000' }));
    await pool.query('UPDATE pools SET results_root = $2 WHERE pool = $1', [
      POOL,
      rootOf(replacement),
    ]);

    const observations: Array<{ status: number; rows: number; amounts: string[] }> = [];
    const watcher = async () => {
      const res = await handleRead(pool, `/pools/${POOL}/leaderboard`);
      const body = res.body as { rows?: Array<{ amount_lamports: string }> };
      observations.push({
        status: res.status,
        rows: body.rows?.length ?? 0,
        amounts: (body.rows ?? []).map((r) => r.amount_lamports),
      });
    };

    let seen = 0;
    const watched = instrumented(pool, async (sql) => {
      // Read from outside at every step of the group: after the DELETE,
      // after each insert, and either side of the vouching flag.
      seen++;
      if (/^(DELETE FROM rankings|INSERT INTO rankings|INSERT INTO bundles)/.test(sql)) {
        await watcher();
      }
    });
    const out = await ingestBundle(
      watched,
      POOL,
      uri,
      fakeFetch({ [uri]: { pool_id: '1', results: replacement } })
    );
    expect(out.ok, out.reason).to.equal(true);
    expect(seen, 'the group issued the statements this test watches').to.be.greaterThan(3);
    expect(observations.length, 'the reader looked at every step').to.be.greaterThan(3);

    // EVERY observation is the complete previous answer. Not "the flag came
    // last" — nothing partial was visible at all.
    for (const [i, o] of observations.entries()) {
      expect(o.status, `observation ${i}`).to.equal(200);
      expect(o.rows, `observation ${i}: a truncated field was served`).to.equal(before.length);
      expect(o.amounts, `observation ${i}: a half-replaced field was served`).to.deep.equal(
        before.map((r) => String(r.amount_lamports))
      );
    }
    // …and afterwards the new answer is the one served.
    const after = await handleRead(pool, `/pools/${POOL}/leaderboard`);
    expect(
      (after.body as { rows: Array<{ amount_lamports: string }> }).rows.map((r) => r.amount_lamports)
    ).to.deep.equal(['3000000000', '500000000', '500000000']);
  });

  it('a mismatch clears the served rankings and the flag together', async () => {
    await ingestBundle(db, POOL, uri, fakeFetch({ [uri]: { pool_id: '1', results } }));
    const tampered = results.map((r) => ({ ...r, amount_lamports: '1' }));
    const out = await ingestBundle(
      db,
      POOL,
      uri,
      fakeFetch({ [uri]: { pool_id: '1', results: tampered } })
    );
    expect(out.ok).to.equal(false);
    expect(out.reason).to.match(/does not match/);
    expect(await servedRows(), 'a cache that failed verification must stop serving').to.deep.equal([]);
    expect(await flag()).to.equal(false);
    const served = await handleRead(pool, `/pools/${POOL}/leaderboard`);
    expect(served.status).to.equal(404);
  });

  it('the backfill walks settled pools through the same ingest, idempotently', async () => {
    await pool.query(
      `INSERT INTO published_bundles (pool_id, uri, published_at) VALUES ('1', $1, 1757600000)`,
      [uri]
    );
    const f = fakeFetch({ [uri]: { pool_id: '1', results } });
    const first = await backfillArchive(db, f, () => {});
    expect(first).to.deep.equal({ attempted: 1, verified: 1, failed: 0, seatsUnresolved: 0 });
    const rowsAfterFirst = await servedRows();
    const second = await backfillArchive(db, f, () => {});
    expect(second).to.deep.equal(first);
    expect(await servedRows(), 'run it twice, same rows').to.deep.equal(rowsAfterFirst);
  });

  it('discovery prefers the daemon`s own record and makes no network call for it', async () => {
    await pool.query(
      `INSERT INTO published_bundles (pool_id, uri, published_at) VALUES ('1', $1, 1757600000)`,
      [uri]
    );
    let calls = 0;
    const counting = (async () => {
      calls++;
      throw new Error('the gateway must not be asked');
    }) as unknown as typeof fetch;
    expect(await discoverBundleUri(pool, '1', counting)).to.equal(uri);
    expect(calls).to.equal(0);
    // …and a pool with no record and no configured upload address gets null
    // rather than an unfiltered tag query (C-25).
    expect(await discoverBundleUri(pool, '999', counting, { log: () => {} })).to.equal(null);
    expect(calls).to.equal(0);
  });
});
