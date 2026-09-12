/**
 * The read API (roadmap 3.2's "reads live from the indexer") — the JSON the
 * app's data seam (app/src/data/) consumes, served straight off the derived
 * tables. Read-only by construction: every handler takes a `Queryable` and
 * issues SELECTs; there is no write path in this module.
 *
 *   GET /pools                         → PoolSummary[] — filterable by
 *                                        ?state=&tier=&before=<id>&limit=
 *                                        (E3: the archive list is
 *                                        /pools?state=Paid, paged by id)
 *   GET /pools/:pool                   → PoolSummary (+ held_shares,
 *                                        resolving, resolving_until — Stage C,
 *                                        derived, see `resolvingOf`)
 *   GET /pools/:pool/entries           → EntryRow[]
 *   GET /pools/:pool/results           → ResultRow[]
 *   GET /pools/:pool/leaderboard       → the VERIFIED archive ranking (E3):
 *                                        404 unless the pool's bundle
 *                                        recomputed to the on-chain root
 *                                        (archive.ts — fail-closed)
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
 *   GET /tiers                         → per-tier `next_open_at` (the
 *                                        cooldown stamp, prompt v2 §B.6)
 *                                        plus `server_time`
 *   GET /time                          → { server_time } — the clock every
 *                                        countdown in the app derives from
 *                                        (never the device's Date.now())
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
import { REVIEW_WINDOW_SECS } from '../../scoring/src/prizes';
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

/** Unix seconds, as the API's clock. Injectable so the routing suite can
 * pin it; every countdown in the app derives from THIS (via `server_time`),
 * never from the device clock. */
export type Now = () => number;
const wallClock: Now = () => Math.floor(Date.now() / 1000);

/**
 * The columns the two pool queries add to `pools.*` for the derived
 * "resolving" flag (Phase 2 Stage C). A HELD SHARE is a payout escrowed at
 * `PrizesPaid` whose entry has not settled either way (`escrow_settled IS
 * NULL`; 0003). `settled_at` is when this indexer first saw the pool's
 * `PrizesPaid` — an observation of the on-chain `Entry.escrowed_at`, which
 * is what the daemon acts on (Stage D) and what a player can verify; the
 * two differ by ingest latency, seconds against a twelve-hour window.
 */
const POOL_DERIVED_COLUMNS = `
  (SELECT count(*)::int FROM payouts py
     JOIN entries en ON en.pool = py.pool AND en.player = py.player
    WHERE py.pool = p.pool AND py.escrowed AND en.escrow_settled IS NULL) AS held_shares,
  (SELECT floor(extract(epoch FROM min(ev.ingested_at)))::text FROM events ev
    WHERE ev.name = 'PrizesPaid' AND ev.raw->>'pool' = p.pool) AS settled_at`;

const POOL_SELECT = `SELECT p.*,${POOL_DERIVED_COLUMNS} FROM pools p`;

/**
 * "Resolving", derived rather than stored (Phase 2 Stage C): a pool is
 * resolving from the moment its prizes settle until either every held share
 * on it is decided or the published window has passed, whichever comes
 * first. A pool with no held share never resolves — "up to 12 hours" means
 * exactly that. No `PoolState` variant carries this; the program's states
 * are unchanged and the copy describes a process the operator runs.
 */
export function resolvingOf(
  heldShares: number,
  settledAt: number | null,
  nowUnix: number
): { resolving: boolean; resolving_until: string | null } {
  if (settledAt === null) return { resolving: false, resolving_until: null };
  const until = settledAt + Number(REVIEW_WINDOW_SECS);
  return { resolving: heldShares > 0 && nowUnix < until, resolving_until: String(until) };
}

function poolRow(r: Record<string, unknown>, now: Now): Json {
  const heldShares = r.held_shares === undefined || r.held_shares === null ? 0 : Number(r.held_shares);
  const settledAt = r.settled_at === undefined || r.settled_at === null ? null : Number(r.settled_at);
  const nowUnix = now();
  return {
    pool: r.pool,
    id: r.id === null ? null : String(r.id),
    tier: r.tier,
    entry_lamports: r.entry_lamports === null ? null : String(r.entry_lamports),
    pot_lamports: r.pot_lamports === null || r.pot_lamports === undefined ? null : String(r.pot_lamports),
    // Set once at open (12 h at launch), never rewritten — option A, the
    // 2026-09-07 ruling; the go-timer and its `go_deadline` are gone.
    fill_deadline: r.fill_deadline === null ? null : String(r.fill_deadline),
    timer_seconds: r.timer_seconds,
    state: r.state,
    entrants: Number(r.entrants),
    sealing_pubkey: r.sealing_pubkey,
    results_root: r.results_root ?? null,
    secret: r.secret ?? null,
    // Stage C: held shares and the derived resolving flag (see `resolvingOf`).
    held_shares: heldShares,
    ...resolvingOf(heldShares, settledAt, nowUnix),
    // The clock the app's countdowns derive from (unix seconds, string).
    server_time: String(nowUnix),
  };
}

/** Dispatch one GET. Unknown path → 404. */
export async function handleRead(
  db: Queryable,
  path: string,
  now: Now = wallClock
): Promise<ReadApiResult> {
  // E3: the path may carry a query string (the /pools filters). Before
  // this, query strings 404ed by falling into the path split.
  const qIndex = path.indexOf('?');
  const pathname = qIndex === -1 ? path : path.slice(0, qIndex);
  const query = new URLSearchParams(qIndex === -1 ? '' : path.slice(qIndex + 1));
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean);

  // E5: the deployment liveness probe.
  if (parts[0] === 'health' && parts.length === 1) {
    return { status: 200, body: { ok: true, service: 'indexer-read-api' } };
  }

  if (parts[0] === 'time' && parts.length === 1) {
    return { status: 200, body: { server_time: String(now()) } };
  }

  if (parts[0] === 'tiers' && parts.length === 1) {
    // Prompt v2 §B.6: the per-tier cooldown stamp, for the "next pool in"
    // countdown. Tiers with no row never settled a pool (next_open_at 0).
    const res = await db.query('SELECT tier, next_open_at, last_pool_id FROM tier_status ORDER BY tier ASC');
    const rows = res.rows as Array<{ tier: number; next_open_at: unknown; last_pool_id: unknown }>;
    return {
      status: 200,
      body: {
        server_time: String(now()),
        tiers: rows.map((t) => ({
          tier: Number(t.tier),
          next_open_at: String(t.next_open_at),
          last_pool_id: t.last_pool_id === null ? null : String(t.last_pool_id),
        })),
      },
    };
  }

  if (parts[0] === 'pools' && parts.length === 1) {
    return poolsList(db, query, now);
  }

  if (parts[0] === 'pools' && parts.length >= 2) {
    const pool = parts[1];
    if (!B58.test(pool)) return { status: 400, body: { error: 'bad pool address' } };

    if (parts.length === 2) {
      const res = await db.query(`${POOL_SELECT} WHERE pool = $1`, [pool]);
      if (res.rows.length === 0) return { status: 404, body: { error: 'not found' } };
      return { status: 200, body: poolRow(res.rows[0], now) };
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
    if (parts[2] === 'leaderboard') {
      return leaderboard(db, pool);
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
    // player_history. `rank` is NULLABLE and comes only from the verified
    // archive (E3): null until the pool's bundle recomputes to the
    // on-chain root, never a claim this service made up on its own.
    if (parts[2] === 'history') {
      const res = await db.query(
        `SELECT h.pool, p.id::text AS pool_id, h.tier, h.seat,
                h.entries_to_date::text AS entries_to_date, h.paid,
                h.amount_lamports::text AS amount_lamports,
                h.pot_lamports::text AS pot_lamports,
                p.state, r.rank
           FROM player_history h
           LEFT JOIN pools p ON p.pool = h.pool
           LEFT JOIN rankings r ON r.pool = h.pool AND r.seat = h.seat
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

/** The pool states the projection writes — the ?state= allowlist. */
const POOL_STATES = new Set(['Open', 'Sealed', 'Scored', 'Paid', 'Refunding', 'Closed']);

/**
 * GET /pools with the E3 filters. Every filter is validated before it
 * touches SQL and every value is a bind parameter — the allowlist plus
 * parameterisation, never string-built SQL. `before` pages by numeric
 * pool id (exclusive), newest first, so the archive list walks backwards
 * with ?state=Paid&before=<last id on the page>.
 */
async function poolsList(db: Queryable, query: URLSearchParams, now: Now): Promise<ReadApiResult> {
  const where: string[] = [];
  const params: unknown[] = [];

  const state = query.get('state');
  if (state !== null) {
    if (!POOL_STATES.has(state)) return { status: 400, body: { error: 'bad state filter' } };
    params.push(state);
    where.push(`state = $${params.length}`);
  }
  const tier = query.get('tier');
  if (tier !== null) {
    if (!/^[0-6]$/.test(tier)) return { status: 400, body: { error: 'bad tier filter' } };
    params.push(Number(tier));
    where.push(`tier = $${params.length}`);
  }
  const before = query.get('before');
  if (before !== null) {
    if (!/^\d{1,19}$/.test(before)) return { status: 400, body: { error: 'bad before cursor' } };
    params.push(before);
    where.push(`id < $${params.length}`);
  }
  let limit = 100;
  const rawLimit = query.get('limit');
  if (rawLimit !== null) {
    if (!/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100) {
      return { status: 400, body: { error: 'bad limit' } };
    }
    limit = Number(rawLimit);
  }
  params.push(limit);

  const clause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
  const res = await db.query(
    `${POOL_SELECT}${clause} ORDER BY id DESC LIMIT $${params.length}`,
    params
  );
  return { status: 200, body: res.rows.map((r) => poolRow(r, now)) };
}

/**
 * E3: the archive leaderboard — served ONLY from a bundle that verified
 * against the on-chain root (fail-closed: no bundles row, or
 * root_matches = false, is a 404, indistinguishable from "no archive").
 * This is the one place rank labels are served, and the provenance rides
 * along: the bundle URI and the root the rows verified against, so the
 * page can link straight to the published data and the verify story.
 */
async function leaderboard(db: Queryable, pool: string): Promise<ReadApiResult> {
  const bundle = await db.query(
    'SELECT uri, results_root, verified_at, root_matches FROM bundles WHERE pool = $1',
    [pool]
  );
  const b = bundle.rows[0] as
    | { uri: string; results_root: string; verified_at: unknown; root_matches: boolean }
    | undefined;
  if (!b || !b.root_matches) {
    return { status: 404, body: { error: 'no verified archive for this pool' } };
  }
  const rows = await db.query(
    `SELECT seat, player, rank, score_half, zones, amount_lamports::text AS amount_lamports
       FROM rankings WHERE pool = $1
      ORDER BY rank ASC, seat ASC`,
    [pool]
  );
  return {
    status: 200,
    body: {
      pool,
      uri: b.uri,
      results_root: b.results_root,
      verified_at: String(b.verified_at),
      rows: rows.rows,
    },
  };
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
 * BR-005 wiring (2026-08-28): the hand-written `access-control-allow-origin:
 * *` is replaced by the shared hygiene layer — `BLOTTO_API_CORS_ORIGINS`
 * is the one CORS mechanism, exact-match origins only. Unconfigured means
 * NO CORS headers: a browser on another origin (the verify page's
 * auto-fetch) cannot read this API until the deployment names its origin. */
export interface ReadApiOptions {
  /**
   * Read the client address from the proxy's headers. Set ONLY behind our
   * own proxy (Fly, compose): a proxy header from anywhere else is
   * caller-supplied, and a rate limiter keyed on it is a rate limiter the
   * caller controls. The packet and review services have always taken this
   * switch; the read API trusted the headers unconditionally until
   * 2026-09-12 (audit 2026-09-11, Tier 3 item 5).
   */
  trustProxyHeader?: boolean;
}

export function serveReadApi(
  db: Queryable,
  port: number,
  hygieneConfig?: HygieneConfig,
  options: ReadApiOptions = {}
): Server {
  const hygiene: HygieneConfig = hygieneConfig ?? {
    rateLimit: { enabled: false, requestsPerMinute: 1, burst: 1, retryAfterSeconds: 1 },
    cors: { allowedOrigins: [] },
    securityHeadersEnabled: false,
  };
  const trustProxy = options.trustProxyHeader === true;
  const limiter = new RateLimiter(hygiene.rateLimit);
  const server = createServer(async (req, res) => {
    const outcome = applyHygiene(
      {
        method: req.method,
        // Same resolver as the packet service: the leftmost X-Forwarded-For
        // hop is caller-supplied, so rate limiting keyed on it was bypassable
        // by rotating one header (found 2026-08-31) — and the headers are
        // read at all only behind a proxy we own.
        forwardedFor: trustProxy ? req.headers['x-forwarded-for'] : undefined,
        flyClientIp: trustProxy ? req.headers['fly-client-ip'] : undefined,
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
