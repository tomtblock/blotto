/**
 * Helius webhook receiver (§3). Authenticates the configured shared secret, decodes each
 * delivered transaction's logs, and ingests through the shared pipeline (idempotent upsert +
 * derived projection). Redelivery/replay is a no-op via the `(signature, event_index)` ledger key.
 *
 * Library choice (flagged, §7): Node's built-in `http` — no express/fastify. The receiver is one
 * POST endpoint; a framework would be dead weight and a dependency to maintain. The pure handler
 * (`handleWebhookPayload`) is split from the socket wiring so offline tests drive it directly,
 * exactly as `me-registration`'s `Watcher.handleLogs` is split from `subscribeProgramLogs`.
 *
 * Failure policy: a DECODE no-op (an unrecognized event) just yields fewer rows — never an error.
 * A STORE error (e.g. Postgres down) returns 500 so Helius redelivers (at-least-once); the
 * redelivery is idempotent. A single delivery never crashes the process — errors are caught,
 * `Monitor.alert`ed, and turned into a 500.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { timingSafeEqual } from 'crypto';
import { ALERT, METRIC, serveMetricsIfPrometheus, type Monitor } from './shared';
import type { Queryable } from './shared';
import type { EventStore } from './store';
import { ingestTransaction, type IngestStats, type TxContext } from './ingest';
import { ingestBundle } from './archive';

export interface WebhookDeps {
  store: EventStore;
  monitor: Monitor;
  /** The configured Helius shared secret (from the config loader, never hard-coded). */
  secret: string;
  /** Commitment label stored on ingested rows. */
  commitment: string;
  /** The emitting program, recorded on every ledger row. */
  program: string;
  /**
   * E3: the derived-tables handle for `POST /bundles` (the daemon's
   * bundle-URI announce). Optional — a deployment without it 404s the
   * path and the archive fills by backfill alone.
   */
  archiveDb?: Queryable;
  /** Injectable fetch for the announce path's bundle download (tests). */
  fetchImpl?: typeof fetch;
}

export interface WebhookResult {
  status: number;
  stats: IngestStats;
}

/** Constant-time compare of the delivered Authorization header against the configured secret. */
export function authorize(
  authHeader: string | undefined,
  secret: string
): boolean {
  if (!authHeader) {
    return false;
  }
  const a = Buffer.from(authHeader);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Normalize a Helius webhook body into `TxContext`s. Helius raw-transaction deliveries are a JSON
 * array; each item carries a signature, slot, and log messages — under a couple of shapes we
 * tolerate here. NOTE (open evidence gate, §8): the exact field shape must be pinned against a
 * real provider delivery; this defensive parser is verified only against fixtures.
 */
export function extractTxContexts(payload: unknown): TxContext[] {
  const items = Array.isArray(payload) ? payload : [payload];
  const out: TxContext[] = [];
  for (const item of items) {
    if (item === null || typeof item !== 'object') {
      continue;
    }
    const obj = item as Record<string, any>;
    const signature: unknown =
      obj.signature ?? obj.transaction?.signatures?.[0] ?? obj.txSignature;
    const logs: unknown = obj.meta?.logMessages ?? obj.logs;
    const slotRaw: unknown = obj.slot ?? obj.meta?.slot;
    if (typeof signature !== 'string' || !Array.isArray(logs) || slotRaw === undefined) {
      continue;
    }
    out.push({
      signature,
      slot: BigInt(slotRaw as string | number),
      logs: logs as string[],
    });
  }
  return out;
}

/**
 * Pure webhook handler. Returns the HTTP status the server should send plus aggregate stats.
 * 401 unauthenticated, 400 unparseable, 500 on a store error (→ Helius retries), 200 otherwise.
 */
export async function handleWebhookPayload(
  deps: WebhookDeps,
  authHeader: string | undefined,
  rawBody: string
): Promise<WebhookResult> {
  const empty: IngestStats = { decoded: 0, inserted: 0, duplicates: 0 };
  if (!authorize(authHeader, deps.secret)) {
    deps.monitor.recordEvent(METRIC.indexer.webhookUnauthorized);
    return { status: 401, stats: empty };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, stats: empty };
  }

  const totals: IngestStats = { decoded: 0, inserted: 0, duplicates: 0 };
  let storeError = false;
  for (const tx of extractTxContexts(payload)) {
    try {
      const s = await ingestTransaction(deps.store, deps.monitor, { commitment: deps.commitment, program: deps.program }, tx);
      totals.decoded += s.decoded;
      totals.inserted += s.inserted;
      totals.duplicates += s.duplicates;
    } catch (err) {
      storeError = true;
      deps.monitor.alert(ALERT.indexer.ingestFailed, {
        signature: tx.signature,
        error: String(err),
      });
    }
  }
  return { status: storeError ? 500 : 200, stats: totals };
}

export interface AnnounceResult {
  status: number;
  body: unknown;
}

/**
 * E3 §4.4 (live path): the daemon announces `{ pool_id, uri }` after the
 * crank publishes a bundle, authenticated by the SAME shared secret as the
 * Helius deliveries. The daemon knows pools by numeric id (its chain seam
 * never exposes the PDA address), so the announce carries the id and THIS
 * side resolves the address from its own `pools` projection. The URI is
 * untrusted by design — everything rides on the Merkle-root check inside
 * `ingestBundle`, so a forged announce can at worst write a loud
 * `root_matches = false` row, never a served ranking.
 *
 *   200 — verified and persisted
 *   409 — fetched but the root did not match (recorded + alerted)
 *   503 — the pool or its on-chain root is not in the ledger yet (the
 *         PoolOpened/ResultsCommitted delivery can lag the daemon's
 *         announce); nothing is persisted, the daemon may retry and the
 *         backfill sweeps stragglers
 *   502 — the bundle could not be fetched or was malformed
 */
export async function handleBundleAnnounce(
  deps: WebhookDeps,
  authHeader: string | undefined,
  rawBody: string
): Promise<AnnounceResult> {
  if (!authorize(authHeader, deps.secret)) {
    deps.monitor.recordEvent(METRIC.indexer.webhookUnauthorized);
    return { status: 401, body: { error: 'unauthorized' } };
  }
  if (!deps.archiveDb) {
    return { status: 404, body: { error: 'archive not configured' } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: 'bad json' } };
  }
  const { pool_id, uri } = (parsed ?? {}) as { pool_id?: unknown; uri?: unknown };
  if (typeof pool_id !== 'string' || !/^\d{1,19}$/.test(pool_id)) {
    return { status: 400, body: { error: 'bad pool id' } };
  }
  if (typeof uri !== 'string' || !/^https:\/\//.test(uri)) {
    return { status: 400, body: { error: 'bad bundle uri' } };
  }

  const found = await deps.archiveDb.query('SELECT pool FROM pools WHERE id = $1', [pool_id]);
  const pool: string | undefined = found.rows[0]?.pool;
  if (!pool) {
    return { status: 503, body: { error: 'pool not indexed yet' } };
  }

  const out = await ingestBundle(deps.archiveDb, pool, uri, deps.fetchImpl ?? fetch);
  if (out.ok) {
    deps.monitor.recordEvent(METRIC.indexer.archiveVerified);
    return { status: 200, body: { verified: true, rows: out.rows } };
  }
  if (out.reason === 'no committed results_root on chain') {
    return { status: 503, body: { error: out.reason } };
  }
  if (out.recomputedRoot !== undefined) {
    deps.monitor.alert(ALERT.indexer.archiveRootMismatch, {
      pool,
      uri,
      recomputedRoot: out.recomputedRoot,
      onChainRoot: out.onChainRoot ?? '',
    });
    return { status: 409, body: { error: out.reason } };
  }
  return { status: 502, body: { error: out.reason } };
}

/** Wire the pure handler onto a Node `http` server. POSTs only; everything else is 404. */
export function createWebhookServer(deps: WebhookDeps): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    // `GET /metrics` for the Alloy scrape, served only under the Prometheus sink (Step 6).
    if (serveMetricsIfPrometheus(deps.monitor, req, res)) {
      return;
    }
    // E5: the deployment liveness probe.
    if (req.method === 'GET' && req.url === '/health') {
      res
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ ok: true, service: 'indexer-webhook' }));
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      // E3: the daemon's bundle announce rides the same server + secret.
      if ((req.url ?? '').split('?')[0] === '/bundles') {
        void handleBundleAnnounce(deps, req.headers.authorization, rawBody)
          .then((result) => {
            res.writeHead(result.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result.body));
          })
          .catch((err) => {
            deps.monitor.alert(ALERT.indexer.handlerThrew, { error: String(err) });
            res.writeHead(500).end();
          });
        return;
      }
      void handleWebhookPayload(deps, req.headers.authorization, rawBody)
        .then((result) => {
          res.writeHead(result.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result.stats));
        })
        .catch((err) => {
          deps.monitor.alert(ALERT.indexer.handlerThrew, { error: String(err) });
          res.writeHead(500).end();
        });
    });
    req.on('error', () => res.writeHead(400).end());
  });
}
