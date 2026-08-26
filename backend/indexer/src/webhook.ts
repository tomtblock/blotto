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
import type { EventStore } from './store';
import { ingestTransaction, type IngestStats, type TxContext } from './ingest';

export interface WebhookDeps {
  store: EventStore;
  monitor: Monitor;
  /** The configured Helius shared secret (from the config loader, never hard-coded). */
  secret: string;
  /** Commitment label stored on ingested rows. */
  commitment: string;
  /** The emitting program, recorded on every ledger row. */
  program: string;
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

/** Wire the pure handler onto a Node `http` server. POSTs only; everything else is 404. */
export function createWebhookServer(deps: WebhookDeps): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    // `GET /metrics` for the Alloy scrape, served only under the Prometheus sink (Step 6).
    if (serveMetricsIfPrometheus(deps.monitor, req, res)) {
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      void handleWebhookPayload(
        deps,
        req.headers.authorization,
        Buffer.concat(chunks).toString('utf8')
      )
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
