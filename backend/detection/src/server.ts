/**
 * The review service's HTTP face (C10) — the server behind the admin
 * review page's POSTs:
 *
 *   POST /decisions  { pool, player, action, criterion, decidedBy,
 *                      decidedAt, signature }        → 204 | 400/401/502
 *   GET  /decisions?pool=<pda>                       → { decisions }
 *
 * Every POST is wallet-signed by a configured reviewer (auth.ts); the one
 * uniform 401 covers unknown signer, bad signature and stale timestamp
 * alike. On success the decision is APPLIED (the settlement-signed chain
 * action) and then LOGGED, in that order — a failed chain action logs
 * nothing and answers 502, so the log never claims an action that did not
 * happen.
 *
 * The GET is deliberately open: the log holds no secrets — pool, player,
 * action, criterion, reviewer key, timestamp, signature — and its whole
 * point is that decisions are re-checkable (the row format's contract is
 * `review.ts`). Routing is a pure function over parsed bodies, same
 * pattern as the entry server, so the suite runs without sockets.
 */

import { createServer, type Server } from 'http';
import { verifyReviewSubmission, type ReviewerRegistry } from './auth';
import { decide, type Decision, type DecisionLog, type ReviewActions } from './review';

export interface ReviewServerDeps {
  registry: ReviewerRegistry;
  actions: ReviewActions;
  log: DecisionLog;
  /** Injectable clock (tests); defaults to Date.now. */
  now?: () => number;
}

export interface ReviewRouteResult {
  status: number;
  body: unknown;
}

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ACTIONS = new Set(['flag', 'clear', 'release', 'forfeit']);

function parseDecision(body: unknown): Decision | null {
  const b = body as Record<string, unknown>;
  if (
    !b ||
    typeof b.pool !== 'string' ||
    !B58.test(b.pool) ||
    typeof b.player !== 'string' ||
    !B58.test(b.player) ||
    typeof b.action !== 'string' ||
    !ACTIONS.has(b.action) ||
    typeof b.criterion !== 'string' ||
    b.criterion.length === 0 ||
    b.criterion.length > 200 ||
    typeof b.decidedBy !== 'string' ||
    !B58.test(b.decidedBy) ||
    typeof b.decidedAt !== 'string' ||
    typeof b.signature !== 'string'
  ) {
    return null;
  }
  return {
    pool: b.pool,
    player: b.player,
    action: b.action as Decision['action'],
    criterion: b.criterion,
    decidedBy: b.decidedBy,
    decidedAt: b.decidedAt,
    signature: b.signature,
  };
}

export async function handleReviewRoute(
  deps: ReviewServerDeps,
  method: string,
  path: string,
  body: unknown
): Promise<ReviewRouteResult> {
  const [route, queryString] = path.split('?', 2);

  // E5: the deployment liveness probe.
  if (route === '/health' && method === 'GET') {
    return { status: 200, body: { ok: true, service: 'review' } };
  }

  if (route === '/decisions' && method === 'GET') {
    const pool = new URLSearchParams(queryString ?? '').get('pool');
    if (!pool || !B58.test(pool)) return { status: 400, body: { error: 'pool' } };
    return { status: 200, body: { decisions: await deps.log.list(pool) } };
  }

  if (route === '/decisions' && method === 'POST') {
    const decision = parseDecision(body);
    if (!decision) return { status: 400, body: { error: 'malformed' } };
    const now = deps.now ?? Date.now;
    if (!verifyReviewSubmission(deps.registry, decision, now())) {
      // Uniform: unknown signer, bad signature and stale look identical.
      return { status: 401, body: { error: 'unauthorized' } };
    }
    try {
      await decide(deps.actions, deps.log, decision);
    } catch (e) {
      // The chain refused (or the RPC died): nothing was logged.
      return { status: 502, body: { error: 'action_failed', detail: String(e) } };
    }
    return { status: 204, body: null };
  }

  if (route === '/decisions') return { status: 405, body: { error: 'method' } };
  return { status: 404, body: { error: 'not found' } };
}

export function serveReviewApi(deps: ReviewServerDeps, port: number): Server {
  const server = createServer(async (req, res) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 16_384) req.destroy();
    });
    req.on('end', async () => {
      let body: unknown = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = null;
      }
      try {
        const { status, body: out } = await handleReviewRoute(
          deps,
          req.method ?? '',
          req.url ?? '/',
          body
        );
        if (out === null) res.writeHead(status).end();
        else
          res
            .writeHead(status, {
              'content-type': 'application/json',
              'access-control-allow-origin': '*',
            })
            .end(JSON.stringify(out));
      } catch {
        res
          .writeHead(500, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: 'internal' }));
      }
    });
  });
  server.listen(port);
  return server;
}
