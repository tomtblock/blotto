/**
 * The read API (roadmap 3.2's "reads live from the indexer") — the JSON the
 * app's data seam (app/src/data/) consumes, served straight off the derived
 * tables. Read-only by construction: every handler takes a `Queryable` and
 * issues SELECTs; there is no write path in this module.
 *
 *   GET /pools                         → PoolSummary[]
 *   GET /pools/:pool                   → PoolSummary
 *   GET /pools/:pool/entries           → EntryRow[]
 *   GET /pools/:pool/results           → ResultRow[]
 *   GET /pools/:pool/payouts           → PayoutRow[]
 *   GET /pools/:pool/verify-record     → the verify page's OnChainRecord,
 *                                        assembled from the raw event ledger
 *                                        (not the derived tables — the verify
 *                                        story deliberately reads closer to
 *                                        the chain)
 *   GET /profiles/:player              → ProfileRow
 *
 * Route handling is a pure function (path → handler) so the suite tests it
 * without sockets; `serveReadApi` is the thin Node http wrapper.
 */

import { createServer, type Server } from 'http';
import type { Queryable } from './shared';

type Json = unknown;

export interface ReadApiResult {
  status: number;
  body: Json;
}

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function poolRow(r: Record<string, unknown>): Json {
  return {
    pool: r.pool,
    id: r.id === null ? null : String(r.id),
    tier: r.tier,
    entry_lamports: r.entry_lamports === null ? null : String(r.entry_lamports),
    fill_deadline: r.fill_deadline === null ? null : String(r.fill_deadline),
    timer_seconds: r.timer_seconds,
    state: r.state,
    entrants: Number(r.entrants),
    sealing_pubkey: r.sealing_pubkey,
    results_root: r.results_root ?? null,
    secret: r.secret ?? null,
  };
}

/** Dispatch one GET. Unknown path → 404. */
export async function handleRead(db: Queryable, path: string): Promise<ReadApiResult> {
  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean);

  if (parts[0] === 'pools' && parts.length === 1) {
    const res = await db.query('SELECT * FROM pools ORDER BY id DESC LIMIT 100');
    return { status: 200, body: res.rows.map(poolRow) };
  }

  if (parts[0] === 'pools' && parts.length >= 2) {
    const pool = parts[1];
    if (!B58.test(pool)) return { status: 400, body: { error: 'bad pool address' } };

    if (parts.length === 2) {
      const res = await db.query('SELECT * FROM pools WHERE pool = $1', [pool]);
      if (res.rows.length === 0) return { status: 404, body: { error: 'not found' } };
      return { status: 200, body: poolRow(res.rows[0]) };
    }
    if (parts[2] === 'entries') {
      const res = await db.query(
        'SELECT * FROM entries WHERE pool = $1 ORDER BY idx ASC',
        [pool]
      );
      return { status: 200, body: res.rows };
    }
    if (parts[2] === 'results') {
      const res = await db.query(
        'SELECT rank, player FROM results WHERE pool = $1 ORDER BY rank ASC',
        [pool]
      );
      return { status: 200, body: res.rows };
    }
    if (parts[2] === 'payouts') {
      const res = await db.query(
        'SELECT rank, player, amount::text AS amount, escrowed FROM payouts WHERE pool = $1 ORDER BY rank ASC',
        [pool]
      );
      return { status: 200, body: res.rows };
    }
    if (parts[2] === 'verify-record') {
      return verifyRecord(db, pool);
    }
    return { status: 404, body: { error: 'not found' } };
  }

  if (parts[0] === 'profiles' && parts.length === 2) {
    const player = parts[1];
    if (!B58.test(player)) return { status: 400, body: { error: 'bad player address' } };
    const res = await db.query('SELECT * FROM profiles WHERE player = $1', [player]);
    if (res.rows.length === 0) return { status: 404, body: { error: 'not found' } };
    const r = res.rows[0];
    return {
      status: 200,
      body: {
        player: r.player,
        pools_entered: String(r.pools_entered),
        ranks_paid: String(r.ranks_paid),
        total_won_lamports: String(r.total_won_lamports),
        best_rank: r.best_rank,
        class_counts: [r.class_0, r.class_1, r.class_2, r.class_3, r.class_4].map(Number),
      },
    };
  }

  return { status: 404, body: { error: 'not found' } };
}

/**
 * The verify page's on-chain record, assembled from the RAW EVENT LEDGER —
 * the same rows a player could rebuild from transaction logs — rather than
 * from the derived tables the rest of the API serves.
 */
async function verifyRecord(db: Queryable, pool: string): Promise<ReadApiResult> {
  const res = await db.query(
    `SELECT name, raw FROM events
      WHERE raw->>'pool' = $1
      ORDER BY slot, signature, event_index`,
    [pool]
  );
  let sealingSecretHashHex = '';
  let entryLamports = '';
  let revealedSecretHex = '';
  let resultsRootHex = '';
  let winners: string[] = [];
  const battlesHashByPlayer: Record<string, string> = {};
  const payouts: Array<{ player: string; rank: number; amount: string }> = [];
  for (const row of res.rows) {
    const e = row.raw as Record<string, unknown>;
    switch (row.name) {
      case 'PoolOpened':
        sealingSecretHashHex = e.sealing_secret_hash as string;
        entryLamports = e.entry_lamports as string;
        break;
      case 'EntryRegistered':
        battlesHashByPlayer[e.player as string] = e.battles_hash as string;
        break;
      case 'PoolSecretRevealed':
        revealedSecretHex = e.secret as string;
        break;
      case 'ResultsCommitted':
        resultsRootHex = e.root as string;
        winners = e.winners as string[];
        break;
      case 'PrizesPaid':
        for (const p of e.payouts as Array<{ player: string; rank: number; amount: string }>) {
          payouts.push({ player: p.player, rank: p.rank, amount: p.amount });
        }
        break;
    }
  }
  if (!entryLamports) return { status: 404, body: { error: 'not found' } };
  return {
    status: 200,
    body: {
      sealingSecretHashHex,
      entryLamports,
      revealedSecretHex,
      resultsRootHex,
      winners,
      battlesHashByPlayer,
      payouts,
    },
  };
}

/** The thin HTTP wrapper. GET-only; everything else is 405. */
export function serveReadApi(db: Queryable, port: number): Server {
  const server = createServer(async (req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    try {
      const { status, body } = await handleRead(db, req.url ?? '/');
      res
        .writeHead(status, {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
        })
        .end(JSON.stringify(body));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' }).end(
        JSON.stringify({ error: 'internal' })
      );
      void e;
    }
  });
  server.listen(port);
  return server;
}
