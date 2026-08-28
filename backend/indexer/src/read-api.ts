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
 *   GET /pools/:pool/sealed-entries    → seat-keyed ciphertexts, served only
 *                                        after the pool secret is on-chain
 *                                        (D3 what-beat-you; fail-closed)
 *   GET /profiles/:player              → ProfileRow
 *   GET /profiles/:player/history      → career rows off player_history (D3)
 *   GET /profiles/:player/rivals       → most-shared co-entrants (D3)
 *   GET /treasury                      → TreasuryReport (D-A1 revised) —
 *                                        assembled from the raw event
 *                                        ledger (treasury-report.ts)
 *   GET /history/summary               → first-time vs repeat paid-seat
 *   GET /history/persistence             rates, paid persistence across
 *   GET /history/entries                 consecutive entries, and the
 *                                        entries-per-wallet distribution
 *                                        (D-A2 v2 — player-history.ts)
 *
 * Route handling is a pure function (path → handler) so the suite tests it
 * without sockets; `serveReadApi` is the thin Node http wrapper.
 */

import { createServer, type Server } from 'http';
import {
  RateLimiter,
  applyHygiene,
  type HygieneConfig,
} from '../../_shared/src/http-hygiene';
import type { Queryable } from './shared';
import { treasuryReport } from './treasury-report';
import {
  historyEntriesDistribution,
  historyPersistence,
  historySummary,
} from './player-history';

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
    pot_lamports: r.pot_lamports === null || r.pot_lamports === undefined ? null : String(r.pot_lamports),
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

  // E5: the deployment liveness probe.
  if (parts[0] === 'health' && parts.length === 1) {
    return { status: 200, body: { ok: true, service: 'indexer-read-api' } };
  }

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
      // The committed payout list, seat-keyed (D3-B). Rank labels are not
      // served here — they live in the published bundle (verify page).
      const res = await db.query(
        'SELECT seat, amount::text AS amount FROM results WHERE pool = $1 ORDER BY seat ASC',
        [pool]
      );
      return { status: 200, body: res.rows };
    }
    if (parts[2] === 'payouts') {
      const res = await db.query(
        'SELECT seat, player, amount::text AS amount, escrowed FROM payouts WHERE pool = $1 ORDER BY seat ASC',
        [pool]
      );
      return { status: 200, body: res.rows };
    }
    if (parts[2] === 'verify-record') {
      return verifyRecord(db, pool);
    }
    if (parts[2] === 'sealed-entries') {
      return sealedEntries(db, pool);
    }
    return { status: 404, body: { error: 'not found' } };
  }

  if (parts[0] === 'treasury' && parts.length === 1) {
    return { status: 200, body: await treasuryReport(db) };
  }

  if (parts[0] === 'history' && parts.length === 2) {
    if (parts[1] === 'summary') return { status: 200, body: await historySummary(db) };
    if (parts[1] === 'persistence') {
      return { status: 200, body: await historyPersistence(db) };
    }
    if (parts[1] === 'entries') {
      return { status: 200, body: await historyEntriesDistribution(db) };
    }
    return { status: 404, body: { error: 'not found' } };
  }

  if (parts[0] === 'profiles' && parts.length === 3) {
    const player = parts[1];
    if (!B58.test(player)) return { status: 400, body: { error: 'bad player address' } };
    // D3: the career record — one row per entry, oldest first, straight off
    // player_history (rank labels deliberately absent; D3-B).
    if (parts[2] === 'history') {
      const res = await db.query(
        `SELECT h.pool, p.id::text AS pool_id, h.tier, h.seat,
                h.entries_to_date::text AS entries_to_date, h.paid,
                h.amount_lamports::text AS amount_lamports,
                h.pot_lamports::text AS pot_lamports,
                p.state
           FROM player_history h
           LEFT JOIN pools p ON p.pool = h.pool
          WHERE h.player = $1
          ORDER BY h.entries_to_date ASC, h.pool ASC`,
        [player]
      );
      return { status: 200, body: res.rows };
    }
    // D3: rivals — the wallets most often in the same pools. Public
    // on-chain co-entry facts only; no ordering by who beat whom (rank
    // labels are not indexed).
    if (parts[2] === 'rivals') {
      const res = await db.query(
        `SELECT o.player,
                COUNT(*)::text AS pools_shared,
                SUM(CASE WHEN o.paid THEN 1 ELSE 0 END)::text AS paid_in_shared
           FROM player_history me
           JOIN player_history o ON o.pool = me.pool AND o.player <> me.player
          WHERE me.player = $1
          GROUP BY o.player
          ORDER BY COUNT(*) DESC, o.player ASC
          LIMIT 8`,
        [player]
      );
      return { status: 200, body: res.rows };
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
        seats_paid: String(r.seats_paid),
        total_won_lamports: String(r.total_won_lamports),
        class_counts: [r.class_0, r.class_1, r.class_2, r.class_3, r.class_4].map(Number),
      },
    };
  }

  return { status: 404, body: { error: 'not found' } };
}

/**
 * D3: the sealed ciphertexts, seat-keyed and ANONYMISED (no player column),
 * served ONLY once the pool's secret is on-chain. Before reveal this
 * endpoint refuses — the sealing property (no early read) is enforced here
 * exactly as everywhere else, even though a ciphertext without the secret
 * is unreadable anyway. After reveal the same bytes are already public in
 * substance: the published bundle carries every decrypted payload, so this
 * adds a bundle-independent path for the what-beat-you view to decrypt and
 * re-score in the browser with the revealed secret.
 */
async function sealedEntries(db: Queryable, pool: string): Promise<ReadApiResult> {
  const state = await db.query('SELECT id, secret FROM pools WHERE pool = $1', [pool]);
  if (state.rows.length === 0) return { status: 404, body: { error: 'not found' } };
  const row = state.rows[0] as { id: unknown; secret: unknown };
  if (row.secret === null || row.secret === undefined) {
    // Fail closed: nothing sealed is served before the reveal.
    return { status: 403, body: { error: 'pool secret not revealed' } };
  }
  const res = await db.query(
    `SELECT e.idx AS seat, encode(s.ciphertext, 'hex') AS ciphertext_hex
       FROM pools p
       JOIN sealed_entries s ON s.pool_id = p.id
       JOIN entries e ON e.pool = p.pool AND e.player = s.player
      WHERE p.pool = $1
      ORDER BY e.idx ASC`,
    [pool]
  );
  return { status: 200, body: res.rows };
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
  let potLamports = '';
  let revealedSecretHex = '';
  let resultsRootHex = '';
  let committedPayouts: Array<{ entryIndex: number; amount: string }> = [];
  const battlesHashByPlayer: Record<string, string> = {};
  const payouts: Array<{ player: string; entryIndex: number; amount: string }> = [];
  for (const row of res.rows) {
    const e = row.raw as Record<string, unknown>;
    switch (row.name) {
      case 'PoolOpened':
        sealingSecretHashHex = e.sealing_secret_hash as string;
        entryLamports = e.entry_lamports as string;
        potLamports = e.pot_lamports as string;
        break;
      case 'EntryRegistered':
        battlesHashByPlayer[e.player as string] = e.battles_hash as string;
        break;
      case 'PoolSecretRevealed':
        revealedSecretHex = e.secret as string;
        break;
      case 'ResultsCommitted':
        resultsRootHex = e.root as string;
        committedPayouts = (
          e.payouts as Array<{ entry_index: number; amount: string }>
        ).map((p) => ({ entryIndex: p.entry_index, amount: p.amount }));
        break;
      case 'PrizesPaid':
        for (const p of e.payouts as Array<{
          player: string;
          entry_index: number;
          amount: string;
        }>) {
          payouts.push({ player: p.player, entryIndex: p.entry_index, amount: p.amount });
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
      potLamports,
      revealedSecretHex,
      resultsRootHex,
      committedPayouts,
      battlesHashByPlayer,
      payouts,
    },
  };
}

/** The thin HTTP wrapper. GET-only; everything else is 405.
 *
 * BR-005 wiring (2026-08-28): the hand-rolled `access-control-allow-origin:
 * *` is replaced by the shared hygiene layer — `BLOTTO_API_CORS_ORIGINS`
 * is the one CORS mechanism, exact-match origins only. Unconfigured means
 * NO CORS headers: a browser on another origin (the verify page's
 * auto-fetch) cannot read this API until the deployment names its origin. */
export function serveReadApi(
  db: Queryable,
  port: number,
  hygieneConfig?: HygieneConfig
): Server {
  const hygiene: HygieneConfig = hygieneConfig ?? {
    rateLimit: { enabled: false, requestsPerMinute: 1, burst: 1, retryAfterSeconds: 1 },
    cors: { allowedOrigins: [] },
    securityHeadersEnabled: false,
  };
  const limiter = new RateLimiter(hygiene.rateLimit);
  const server = createServer(async (req, res) => {
    const outcome = applyHygiene(
      {
        method: req.method,
        forwardedFor: req.headers['x-forwarded-for'],
        remoteAddress: req.socket.remoteAddress ?? undefined,
        origin: req.headers.origin,
      },
      hygiene,
      limiter
    );
    if (outcome.kind === 'preflight') {
      res.writeHead(outcome.status, outcome.headers).end();
      return;
    }
    if (outcome.kind === 'rate_limited') {
      res
        .writeHead(outcome.status, { 'content-type': 'application/json', ...outcome.headers })
        .end(JSON.stringify(outcome.body));
      return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405, outcome.headers).end();
      return;
    }
    try {
      const { status, body } = await handleRead(db, req.url ?? '/');
      res
        .writeHead(status, {
          'content-type': 'application/json',
          ...outcome.headers,
        })
        .end(JSON.stringify(body));
    } catch (e) {
      res
        .writeHead(500, { 'content-type': 'application/json', ...outcome.headers })
        .end(JSON.stringify({ error: 'internal' }));
      void e;
    }
  });
  server.listen(port);
  return server;
}
