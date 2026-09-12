/**
 * E3 archive specs (proposal E1 §4) — offline, over an in-memory Queryable
 * and an injected fetch. The properties the archive's trust story rests on:
 *
 *   - a bundle that recomputes to the on-chain root persists, idempotently;
 *   - a bundle that does NOT verify is recorded as a mismatch, is never
 *     served, and CLEARS any previously served rankings for the pool;
 *   - a missing/unfetchable bundle persists nothing at all;
 *   - the backfill walks every settled pool through the SAME ingest path
 *     and is idempotent (run twice, same rows);
 *   - the announce endpoint (webhook `POST /bundles`) authenticates with
 *     the shared secret, resolves pool id → address from the projection,
 *     and alerts loudly on a root mismatch.
 *
 * Since 2026-09-12 (founder ruling D-E8; audit B-07 / D-28 / F-06 / B-20 /
 * F-05 / C-25) four more:
 *
 *   - a row's SEAT comes from our own entry projection, never from the
 *     uploaded file, and is null when our ledger has no entry for that
 *     player — the prize still verifies;
 *   - the write is ONE unit with the vouching flag last, so a failure
 *     part-way leaves the previous verified answer whole rather than an
 *     empty leaderboard still flagged verified;
 *   - a bundle naming one player twice is refused;
 *   - discovery reads the daemon's own record of what it published, and
 *     asks the gateway only for OUR uploads — never for anything wearing
 *     our tags.
 *
 * The bundles here are REAL in the only sense that matters: their roots
 * are computed by the same leafBytes/merkleRoot the crank commits with,
 * so a passing spec exercises the identical byte layout end to end.
 */
import { expect } from 'chai';
import { leafBytes, merkleRoot } from '../../scoring/src/merkle';
import { base58Encode, base58Decode } from '../src/shared';
import type { Queryable } from '../src/shared';
import {
  backfillArchive,
  discoverBundleUri,
  ingestBundle,
  recomputeRoot,
  type BundleResultRow,
} from '../src/archive';
import type { AtomicDb } from '../src/atomic';
import { handleBundleAnnounce, type WebhookDeps } from '../src/webhook';
import { handleRead } from '../src/read-api';
import { ALERT, SILENT_MONITOR, type Monitor } from '../src/shared';
import { InMemoryEventStore } from '../src/store';

const POOL = 'F1XTUREPoo1111111111111111111111111111111111';
const SECRET = 'topsecret-shared-key';

/** A deterministic 32-byte player key per seat, base58 like production. */
function playerB58(seat: number): string {
  const b = new Uint8Array(32);
  b.fill(7);
  b[0] = 1 + seat; // non-zero lead byte keeps the round-trip length stable
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

/**
 * The in-memory database: just enough SQL understanding for archive.ts and
 * the leaderboard/pools reads — dispatch on statement shape, state in Maps.
 */
class MemDb implements AtomicDb {
  pools = new Map<string, { pool: string; id: string; state: string; results_root: string | null }>();
  bundles = new Map<string, { pool: string; uri: string; results_root: string; root_matches: boolean }>();
  rankings = new Map<string, Record<string, unknown>>(); // key `${pool}:${player}`
  /** Our own projection of EntryRegistered: `${pool}:${player}` → seat. */
  entries = new Map<string, number>();
  /** The daemon's record of what it published: pool id → uri. */
  publishedBundles = new Map<string, string>();
  /** Every statement this double has seen, in order — BEGIN/COMMIT too. */
  log: string[] = [];
  /** Set to make the Nth statement inside a group throw (rollback test). */
  failOnStatement: { sql: RegExp; times: number } | null = null;

  /**
   * Group writes the way `withTransaction` does: everything inside lands or
   * nothing does. The double keeps a snapshot and restores it on a throw,
   * which is exactly the property the real BEGIN/ROLLBACK buys and the only
   * one these specs can observe offline.
   */
  async atomically<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    const snapshot = {
      bundles: new Map(this.bundles),
      rankings: new Map(this.rankings),
    };
    this.log.push('BEGIN');
    try {
      const out = await fn(this);
      this.log.push('COMMIT');
      return out;
    } catch (e) {
      this.bundles = snapshot.bundles;
      this.rankings = snapshot.rankings;
      this.log.push('ROLLBACK');
      throw e;
    }
  }

  // Queryable's return is pg's full QueryResult; the archive only ever
  // reads `rows`, so the double is narrowed with the same `as never`
  // idiom the read-api spec's canned db uses.
  async query(sql: string, params: readonly unknown[] = []): ReturnType<Queryable['query']> {
    return (await this.run(sql, params)) as never;
  }

  private async run(sql: string, params: readonly unknown[]): Promise<{ rows: any[] }> {
    const s = sql.replace(/\s+/g, ' ').trim();
    this.log.push(s);
    if (this.failOnStatement && this.failOnStatement.sql.test(s)) {
      if (this.failOnStatement.times-- > 0) {
        throw new Error('MemDb: injected failure');
      }
    }
    if (s.startsWith('SELECT player, idx FROM entries')) {
      const rows = [...this.entries.entries()]
        .filter(([k]) => k.startsWith(`${params[0]}:`))
        .map(([k, idx]) => ({ player: k.slice(String(params[0]).length + 1), idx }));
      return { rows };
    }
    if (s.startsWith('SELECT uri FROM published_bundles')) {
      const uri = this.publishedBundles.get(String(params[0]));
      return { rows: uri ? [{ uri }] : [] };
    }
    if (s.startsWith('SELECT results_root FROM pools')) {
      const p = this.pools.get(params[0] as string);
      return { rows: p ? [{ results_root: p.results_root }] : [] };
    }
    if (s.startsWith('SELECT pool FROM pools WHERE id')) {
      for (const p of this.pools.values()) {
        if (p.id === String(params[0])) return { rows: [{ pool: p.pool }] };
      }
      return { rows: [] };
    }
    if (s.startsWith('SELECT pool, id FROM pools')) {
      // backfill's settled-pool walk
      return {
        rows: [...this.pools.values()]
          .filter((p) => p.state === 'Paid' && p.results_root !== null)
          .sort((a, b) => Number(a.id) - Number(b.id))
          .map((p) => ({ pool: p.pool, id: p.id })),
      };
    }
    if (s.startsWith('INSERT INTO bundles')) {
      const [pool, uri, results_root, root_matches] = params as [string, string, string, boolean];
      this.bundles.set(pool, { pool, uri, results_root, root_matches });
      return { rows: [] };
    }
    if (s.startsWith('DELETE FROM rankings')) {
      for (const key of [...this.rankings.keys()]) {
        if (key.startsWith(`${params[0]}:`)) this.rankings.delete(key);
      }
      return { rows: [] };
    }
    if (s.startsWith('INSERT INTO rankings')) {
      const [pool, player, seat, rank, score_half, zones, amount_lamports] = params;
      this.rankings.set(`${pool}:${player}`, {
        seat, player, rank, score_half, zones, amount_lamports,
      });
      return { rows: [] };
    }
    if (s.startsWith('SELECT uri, results_root, verified_at, root_matches FROM bundles')) {
      const b = this.bundles.get(params[0] as string);
      return { rows: b ? [{ ...b, verified_at: '2026-09-06T00:00:00Z' }] : [] };
    }
    if (s.startsWith('SELECT player, rank, amount_lamports::text AS amount_lamports, seat')) {
      const rows: any[] = [...this.rankings.entries()]
        .filter(([k]) => k.startsWith(`${params[0]}:`))
        .map(([, v]) => ({ ...v, amount_lamports: String(v.amount_lamports) }));
      rows.sort(
        (a, b) =>
          a.rank - b.rank ||
          (a.seat ?? Number.MAX_SAFE_INTEGER) - (b.seat ?? Number.MAX_SAFE_INTEGER) ||
          String(a.player).localeCompare(String(b.player))
      );
      return { rows };
    }
    throw new Error(`MemDb: unhandled SQL: ${s}`);
  }
}

/** Injected fetch serving canned JSON bodies by exact URI. */
function fakeFetch(byUri: Record<string, unknown>): typeof fetch {
  return (async (input: any) => {
    const uri = String(input);
    if (uri in byUri) {
      return { ok: true, status: 200, json: async () => byUri[uri] } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' } as Response;
  }) as typeof fetch;
}

/** Our own projection of EntryRegistered for the fixture field. */
function seatFixtures(db: MemDb, pool = POOL): void {
  for (const seat of [0, 1, 2]) db.entries.set(`${pool}:${playerB58(seat)}`, seat);
}

describe('the archive ingest (E3)', () => {
  it('persists a bundle that recomputes to the on-chain root, idempotently', async () => {
    const results = makeResults();
    const db = new MemDb();
    db.pools.set(POOL, { pool: POOL, id: '1', state: 'Paid', results_root: rootOf(results) });
    seatFixtures(db);
    const f = fakeFetch({ 'https://gw/bundle1': { pool_id: '1', results } });

    const out = await ingestBundle(db, POOL, 'https://gw/bundle1', f);
    expect(out.ok).to.equal(true);
    expect(out.rootMatches).to.equal(true);
    expect(out.rows).to.equal(3);
    expect(db.bundles.get(POOL)?.root_matches).to.equal(true);
    expect(db.rankings.size).to.equal(3);

    const again = await ingestBundle(db, POOL, 'https://gw/bundle1', f);
    expect(again.ok).to.equal(true);
    expect(db.rankings.size).to.equal(3, 'idempotent: same rows, not doubled');
  });

  it('rejects a tampered bundle, records the mismatch, and clears served rankings', async () => {
    const results = makeResults();
    const db = new MemDb();
    db.pools.set(POOL, { pool: POOL, id: '1', state: 'Paid', results_root: rootOf(results) });
    seatFixtures(db);

    // First a good ingest, so there is something served to lose.
    await ingestBundle(db, POOL, 'https://gw/good', fakeFetch({ 'https://gw/good': { results } }));
    expect(db.rankings.size).to.equal(3);

    // One lamport moved from the winner: the root must not survive it.
    const tampered = makeResults();
    tampered[0].amount_lamports = '3999999999';
    const out = await ingestBundle(
      db, POOL, 'https://gw/evil', fakeFetch({ 'https://gw/evil': { results: tampered } })
    );
    expect(out.ok).to.equal(false);
    expect(out.rootMatches).to.equal(false);
    expect(out.recomputedRoot).to.not.equal(out.onChainRoot);
    expect(db.bundles.get(POOL)?.root_matches).to.equal(false);
    expect(db.rankings.size).to.equal(0, 'a failed re-verification must stop serving');
  });

  it('persists nothing when the bundle cannot be fetched or is malformed', async () => {
    const db = new MemDb();
    db.pools.set(POOL, { pool: POOL, id: '1', state: 'Paid', results_root: 'aa'.repeat(32) });

    const gone = await ingestBundle(db, POOL, 'https://gw/missing', fakeFetch({}));
    expect(gone.ok).to.equal(false);
    expect(gone.reason).to.match(/fetch failed/);
    expect(db.bundles.size).to.equal(0, 'no attempt row for a fetch failure');

    const junk = await ingestBundle(
      db, POOL, 'https://gw/junk',
      fakeFetch({ 'https://gw/junk': { results: [{ index: 0, rank: 0 }] } })
    );
    expect(junk.ok).to.equal(false);
    expect(junk.reason).to.match(/malformed/);
    expect(db.bundles.size).to.equal(0);
  });

  it('refuses to verify against nothing: no on-chain root, no ingest', async () => {
    const db = new MemDb();
    db.pools.set(POOL, { pool: POOL, id: '1', state: 'Paid', results_root: null });
    const out = await ingestBundle(db, POOL, 'https://gw/b', fakeFetch({}));
    expect(out.ok).to.equal(false);
    expect(out.reason).to.equal('no committed results_root on chain');
    expect(db.bundles.size).to.equal(0);
  });

  it('recomputeRoot reproduces the committed leaf layout exactly', () => {
    const results = makeResults();
    expect(recomputeRoot(results)).to.equal(rootOf(results));
  });
});

/*
 * The properties founder ruling D-E8 turns on (audit B-07 / D-28 / F-06),
 * plus the two write-ordering defects it sits beside (B-20 / F-05).
 */
describe('what the archive presents as verified (D-E8)', () => {
  it('takes the seat from our own entry projection, never from the uploaded file', async () => {
    const results = makeResults();
    const db = new MemDb();
    db.pools.set(POOL, { pool: POOL, id: '1', state: 'Paid', results_root: rootOf(results) });
    // Our ledger says the rank-1 player sat in seat 5. The bundle claims 2.
    // The root commits to neither, so the file's claim carries no weight.
    db.entries.set(`${POOL}:${playerB58(2)}`, 5);
    db.entries.set(`${POOL}:${playerB58(0)}`, 0);
    db.entries.set(`${POOL}:${playerB58(1)}`, 1);

    const out = await ingestBundle(db, POOL, 'https://gw/b', fakeFetch({ 'https://gw/b': { results } }));
    expect(out.ok).to.equal(true);
    expect(out.seatsUnresolved).to.equal(0);

    const body = (await handleRead(db, `/pools/${POOL}/leaderboard`)).body as {
      rows: Array<{ seat: number | null; rank: number }>;
    };
    expect(body.rows[0].rank).to.equal(1);
    expect(body.rows[0].seat).to.equal(5, "our record of the chain, not the bundle's index");
  });

  it('still serves a verified prize when our ledger has no entry for that player', async () => {
    const results = makeResults();
    const db = new MemDb();
    db.pools.set(POOL, { pool: POOL, id: '1', state: 'Paid', results_root: rootOf(results) });
    // Only two of the three entries reached us — a dropped delivery.
    db.entries.set(`${POOL}:${playerB58(0)}`, 0);
    db.entries.set(`${POOL}:${playerB58(1)}`, 1);

    const out = await ingestBundle(db, POOL, 'https://gw/b', fakeFetch({ 'https://gw/b': { results } }));
    expect(out.ok).to.equal(true);
    expect(out.rows).to.equal(3, 'the prize verified; only our seat record is short');
    expect(out.seatsUnresolved).to.equal(1, 'counted, so a missed delivery is visible');

    const body = (await handleRead(db, `/pools/${POOL}/leaderboard`)).body as {
      rows: Array<{ seat: number | null; player: string; rank: number }>;
    };
    expect(body.rows).to.have.length(3);
    const winner = body.rows.find((r) => r.rank === 1);
    expect(winner?.player).to.equal(playerB58(2));
    expect(winner?.seat).to.equal(null, 'unknown is null, never a guess');
  });

  it('refuses a bundle that names one player twice, even if the root matches it', async () => {
    // A list the tree is perfectly happy to commit to: the same wallet at
    // two ranks. Under a seat key both rows were stored and both served.
    const doubled: BundleResultRow[] = [
      { index: 0, player: playerB58(0), score_half: 20, zones: 5, rank: 1, amount_lamports: '4000000000' },
      { index: 1, player: playerB58(0), score_half: 4, zones: 1, rank: 2, amount_lamports: '0' },
    ];
    const db = new MemDb();
    db.pools.set(POOL, { pool: POOL, id: '1', state: 'Paid', results_root: rootOf(doubled) });
    db.entries.set(`${POOL}:${playerB58(0)}`, 0);

    const out = await ingestBundle(db, POOL, 'https://gw/b', fakeFetch({ 'https://gw/b': { results: doubled } }));
    expect(out.ok).to.equal(false);
    expect(out.reason).to.match(/names a player twice/);
    expect(db.bundles.size).to.equal(0, 'refused before anything is recorded');
    expect(db.rankings.size).to.equal(0);
  });
});

/*
 * B-20 / F-05: the write used to be four independent autocommits with the
 * vouching flag FIRST. A crash after the wholesale delete left an empty
 * leaderboard still flagged verified, and any reader between the flag and
 * the last insert saw a truncated field presented as the whole result.
 */
describe('the archive write lands as one unit (B-20 / F-05)', () => {
  it('keeps the previous verified answer whole when a write fails part-way', async () => {
    const results = makeResults();
    const db = new MemDb();
    db.pools.set(POOL, { pool: POOL, id: '1', state: 'Paid', results_root: rootOf(results) });
    seatFixtures(db);
    await ingestBundle(db, POOL, 'https://gw/good', fakeFetch({ 'https://gw/good': { results } }));
    expect(db.rankings.size).to.equal(3);
    const before = db.bundles.get(POOL)?.uri;

    // The same bundle again, with the second ranking insert failing.
    db.failOnStatement = { sql: /^INSERT INTO rankings/, times: 2 };
    let threw = false;
    try {
      await ingestBundle(db, POOL, 'https://gw/good2', fakeFetch({ 'https://gw/good2': { results } }));
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true, 'the failure surfaces rather than being swallowed');
    expect(db.log).to.contain('ROLLBACK');
    expect(db.rankings.size).to.equal(3, 'not an empty leaderboard still flagged verified');
    expect(db.bundles.get(POOL)?.uri).to.equal(before, 'yesterday\'s answer, untouched');
  });

  it('writes the vouching flag after the rows it vouches for, inside one group', async () => {
    const results = makeResults();
    const db = new MemDb();
    db.pools.set(POOL, { pool: POOL, id: '1', state: 'Paid', results_root: rootOf(results) });
    seatFixtures(db);
    await ingestBundle(db, POOL, 'https://gw/b', fakeFetch({ 'https://gw/b': { results } }));

    const begin = db.log.lastIndexOf('BEGIN');
    const commit = db.log.lastIndexOf('COMMIT');
    const lastRow = db.log.map((l) => l.startsWith('INSERT INTO rankings')).lastIndexOf(true);
    const flag = db.log.map((l) => l.startsWith('INSERT INTO bundles')).lastIndexOf(true);
    expect(begin).to.be.lessThan(lastRow);
    expect(lastRow).to.be.lessThan(flag, 'root_matches is never visible before its rows');
    expect(flag).to.be.lessThan(commit, 'and all of it lands together');
  });
});

describe('the archive read path (E3)', () => {
  it('serves the leaderboard only for a verified pool, 404 otherwise', async () => {
    const results = makeResults();
    const db = new MemDb();
    db.pools.set(POOL, { pool: POOL, id: '1', state: 'Paid', results_root: rootOf(results) });
    seatFixtures(db);

    // Nothing ingested yet → 404, indistinguishable from "no archive".
    expect((await handleRead(db, `/pools/${POOL}/leaderboard`)).status).to.equal(404);

    await ingestBundle(db, POOL, 'https://gw/b', fakeFetch({ 'https://gw/b': { results } }));
    const ok = await handleRead(db, `/pools/${POOL}/leaderboard`);
    expect(ok.status).to.equal(200);
    const body = ok.body as {
      uri: string;
      results_root: string;
      committed_fields: string[];
      rows: Array<Record<string, any>>;
    };
    expect(body.uri).to.equal('https://gw/b');
    expect(body.results_root).to.equal(rootOf(results));
    expect(body.rows.map((r) => r.rank)).to.deep.equal([1, 2, 3], 'rank order');
    expect(body.rows[0].amount_lamports).to.equal('4000000000');

    // D-E8: the response says what the root covers, and puts everything it
    // does not cover somewhere a reader cannot mistake for covered.
    expect(body.committed_fields).to.deep.equal(['player', 'rank', 'amount_lamports']);
    expect(body.rows[0]).to.have.property('recomputed');
    expect(body.rows[0].recomputed).to.deep.equal({ score_half: 20, zones: 5 });
    expect(body.rows[0]).to.not.have.property('score_half', 'uncommitted fields never sit at row level');
    expect(body.rows[0]).to.not.have.property('zones');
    expect(body.rows[0].seat).to.equal(2, 'from our own entry projection');

    // A later mismatch takes it straight back to 404 (fail-closed).
    const tampered = makeResults();
    tampered[0].amount_lamports = '1';
    await ingestBundle(db, POOL, 'https://gw/t', fakeFetch({ 'https://gw/t': { results: tampered } }));
    expect((await handleRead(db, `/pools/${POOL}/leaderboard`)).status).to.equal(404);
  });
});

describe('the archive backfill (E3 §4.4)', () => {
  const POOL2 = 'F1XTUREPoo2222222222222222222222222222222222';

  const UPLOADER = 'B1ottoUp1oadWa11et11111111111111111111111111';

  /** Fetch that answers BOTH the Irys GraphQL discovery and the gateway GETs. */
  function backfillFetch(
    txByPool: Record<string, string>,
    bodyByUri: Record<string, unknown>,
    seen: { owners: string[] } = { owners: [] }
  ): typeof fetch {
    return (async (input: any, init?: any) => {
      const uri = String(input);
      if (uri.endsWith('/graphql')) {
        const q = String(JSON.parse(String(init.body)).query);
        const owner = /owners: \["([^"]+)"\]/.exec(q)?.[1];
        if (owner) seen.owners.push(owner);
        const poolId = /Blotto-Pool", values: \["(\d+)"\]/.exec(q)?.[1] ?? '';
        const id = txByPool[poolId];
        return {
          ok: true, status: 200,
          json: async () => ({ data: { transactions: { edges: id ? [{ node: { id } }] : [] } } }),
        } as Response;
      }
      if (uri in bodyByUri) {
        return { ok: true, status: 200, json: async () => bodyByUri[uri] } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as typeof fetch;
  }

  it('walks settled pools through the same ingest, idempotently; a missing bundle is a counted failure', async () => {
    const r1 = makeResults();
    const r2 = makeResults().map((r) => ({ ...r, amount_lamports: r.rank === 1 ? '20000000000' : '0' }));
    const db = new MemDb();
    db.pools.set(POOL, { pool: POOL, id: '1', state: 'Paid', results_root: rootOf(r1) });
    db.pools.set(POOL2, { pool: POOL2, id: '2', state: 'Paid', results_root: rootOf(r2) });
    // A third pool, not settled: the walk must skip it entirely.
    db.pools.set('F1XTUREPoo3333333333333333333333333333333333', {
      pool: 'F1XTUREPoo3333333333333333333333333333333333', id: '3', state: 'Open', results_root: null,
    });

    const f = backfillFetch(
      { '1': 'tx1', '2': 'tx2' },
      {
        'https://gateway.irys.xyz/tx1': { results: r1 },
        'https://gateway.irys.xyz/tx2': { results: r2 },
      }
    );
    const quiet = () => undefined;
    const opts = { uploaderAddress: UPLOADER };
    const first = await backfillArchive(db, f, quiet, opts);
    expect(first).to.deep.equal({ attempted: 2, verified: 2, failed: 0, seatsUnresolved: 6 });
    expect(db.rankings.size).to.equal(6);

    const second = await backfillArchive(db, f, quiet, opts);
    expect(second).to.deep.equal({ attempted: 2, verified: 2, failed: 0, seatsUnresolved: 6 });
    expect(db.rankings.size).to.equal(6, 'run twice, same rows');

    // Drop pool 2's transaction from discovery: counted, not fatal.
    const partial = await backfillArchive(
      db,
      backfillFetch({ '1': 'tx1' }, { 'https://gateway.irys.xyz/tx1': { results: r1 } }),
      quiet,
      opts
    );
    expect(partial.attempted).to.equal(2);
    expect(partial.verified).to.equal(1);
    expect(partial.failed).to.equal(1);
  });

  it('prefers the daemon\'s own record of what it published over any gateway query', async () => {
    const r1 = makeResults();
    const db = new MemDb();
    db.pools.set(POOL, { pool: POOL, id: '1', state: 'Paid', results_root: rootOf(r1) });
    seatFixtures(db);
    db.publishedBundles.set('1', 'https://gateway.irys.xyz/ourOwnUpload');

    // The gateway would answer with a DIFFERENT transaction. It must not be
    // asked at all: our own record of the upload is the better authority and
    // involves no third party.
    const seen = { owners: [] as string[] };
    const f = backfillFetch(
      { '1': 'someStrangersTx' },
      { 'https://gateway.irys.xyz/ourOwnUpload': { results: r1 } },
      seen
    );
    const out = await backfillArchive(db, f, () => undefined, { uploaderAddress: UPLOADER });
    expect(out.verified).to.equal(1);
    expect(seen.owners).to.deep.equal([], 'the gateway was never queried');
    expect(db.bundles.get(POOL)?.uri).to.equal('https://gateway.irys.xyz/ourOwnUpload');
  });
});

/*
 * C-25: discovery used to ask the gateway for anything wearing our two tags
 * and take the newest answer, so any address could upload a same-tagged
 * object and win the query. The root check behind it would still have
 * refused the contents — this is the layer that stops us fetching a
 * stranger's object at all.
 */
describe('bundle discovery (C-25)', () => {
  const UPLOADER = 'B1ottoUp1oadWa11et11111111111111111111111111';

  function graphqlFetch(seen: { queries: string[] }): typeof fetch {
    return (async (_input: any, init?: any) => {
      seen.queries.push(String(JSON.parse(String(init.body)).query));
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { transactions: { edges: [{ node: { id: 'txFound' } }] } } }),
      } as Response;
    }) as typeof fetch;
  }

  it('asks the gateway only for OUR uploads', async () => {
    const db = new MemDb();
    const seen = { queries: [] as string[] };
    const uri = await discoverBundleUri(db, '7', graphqlFetch(seen), { uploaderAddress: UPLOADER });
    expect(uri).to.equal('https://gateway.irys.xyz/txFound');
    expect(seen.queries).to.have.length(1);
    expect(seen.queries[0]).to.contain(`owners: ["${UPLOADER}"]`);
    expect(seen.queries[0]).to.contain('"Blotto-Pool", values: ["7"]');
  });

  it('does not query the gateway at all when our upload address is unknown', async () => {
    const db = new MemDb();
    const seen = { queries: [] as string[] };
    const lines: string[] = [];
    const uri = await discoverBundleUri(db, '7', graphqlFetch(seen), { log: (l) => lines.push(l) });
    expect(uri).to.equal(null, 'unfiltered is not a fallback — it is the hole');
    expect(seen.queries).to.deep.equal([]);
    expect(lines.join(' ')).to.contain('BLOTTO_IRYS_UPLOAD_ADDRESS');
  });

  it('returns the recorded URI without a network call when we have one', async () => {
    const db = new MemDb();
    db.publishedBundles.set('7', 'https://gateway.irys.xyz/recorded');
    const seen = { queries: [] as string[] };
    const uri = await discoverBundleUri(db, '7', graphqlFetch(seen), { uploaderAddress: UPLOADER });
    expect(uri).to.equal('https://gateway.irys.xyz/recorded');
    expect(seen.queries).to.deep.equal([]);
  });
});

describe('the bundle announce (webhook POST /bundles)', () => {
  function announceDeps(db: MemDb, f: typeof fetch, monitor: Monitor = SILENT_MONITOR): WebhookDeps {
    return {
      store: new InMemoryEventStore(),
      monitor,
      secret: SECRET,
      commitment: 'finalized',
      program: 'ProgRam11111111111111111111111111111111111',
      archiveDb: db,
      fetchImpl: f,
    };
  }

  it('authenticates, resolves the pool id, verifies and persists', async () => {
    const results = makeResults();
    const db = new MemDb();
    db.pools.set(POOL, { pool: POOL, id: '7', state: 'Paid', results_root: rootOf(results) });
    const deps = announceDeps(db, fakeFetch({ 'https://gw/b': { results } }));

    const unauth = await handleBundleAnnounce(deps, 'wrong', JSON.stringify({ pool_id: '7', uri: 'https://gw/b' }));
    expect(unauth.status).to.equal(401);
    expect(db.rankings.size).to.equal(0);

    const ok = await handleBundleAnnounce(deps, SECRET, JSON.stringify({ pool_id: '7', uri: 'https://gw/b' }));
    expect(ok.status).to.equal(200);
    expect(db.rankings.size).to.equal(3);
  });

  it('400s malformed input, 503s an unindexed pool (retryable, nothing persisted)', async () => {
    const db = new MemDb();
    const deps = announceDeps(db, fakeFetch({}));
    expect((await handleBundleAnnounce(deps, SECRET, 'not json')).status).to.equal(400);
    expect(
      (await handleBundleAnnounce(deps, SECRET, JSON.stringify({ pool_id: 'x', uri: 'https://gw/b' }))).status
    ).to.equal(400);
    expect(
      (await handleBundleAnnounce(deps, SECRET, JSON.stringify({ pool_id: '7', uri: 'http://insecure' }))).status
    ).to.equal(400);
    expect(
      (await handleBundleAnnounce(deps, SECRET, JSON.stringify({ pool_id: '7', uri: 'https://gw/b' }))).status
    ).to.equal(503);
    expect(db.bundles.size).to.equal(0);
  });

  it('409s and ALERTS on a root mismatch — the forged-announce worst case is a loud row', async () => {
    const results = makeResults();
    const tampered = makeResults();
    tampered[0].amount_lamports = '1';
    const db = new MemDb();
    db.pools.set(POOL, { pool: POOL, id: '7', state: 'Paid', results_root: rootOf(results) });
    const alerts: Array<{ reason: string; detail: Record<string, unknown> }> = [];
    const monitor: Monitor = {
      recordEvent: () => undefined,
      reportGauge: () => undefined,
      alert: (reason, detail) => alerts.push({ reason, detail }),
    };
    const deps = announceDeps(db, fakeFetch({ 'https://gw/t': { results: tampered } }), monitor);

    const res = await handleBundleAnnounce(deps, SECRET, JSON.stringify({ pool_id: '7', uri: 'https://gw/t' }));
    expect(res.status).to.equal(409);
    expect(alerts).to.have.length(1);
    expect(alerts[0].reason).to.equal(ALERT.indexer.archiveRootMismatch);
    expect(alerts[0].detail.pool).to.equal(POOL);
    expect(db.bundles.get(POOL)?.root_matches).to.equal(false);
    expect(db.rankings.size).to.equal(0);
  });
});
