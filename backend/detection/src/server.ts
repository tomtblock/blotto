/**
 * The review service's HTTP face (C10; appeals and hygiene since Phase 2
 * Stage E) — the server behind the admin review page's POSTs and the
 * results page's appeal form:
 *
 *   POST /decisions  { pool, player, action, criterion, decidedBy,
 *                      decidedAt, signature }
 *                    → 204 applied | 202 forfeit recorded, admin lands it
 *                    | 400 / 401 / 409 / 502
 *   POST /appeals    { pool, player, grounds, signedAt, signature }
 *                    → 204 | 400 / 401 / 409       (player-signed)
 *   GET  /decisions?pool=<pda>[&player=<wallet>]  → { decisions }
 *   GET  /appeals?pool=<pda>&player=<wallet>      → the entry's appeal state
 *
 * Every decision POST is wallet-signed by a configured reviewer (auth.ts);
 * the one uniform 401 covers unknown signer, bad signature and stale
 * timestamp alike. An appeal POST is signed by the entry's own player. The
 * 409s are RULE refusals for a verified signer (nothing to appeal, already
 * lodged, window closed, no open appeal, same reviewer) and say which —
 * they leak nothing an outsider could not read from the public log.
 *
 * Apply-then-log for flag/clear/release (a failed chain action logs nothing
 * and answers 502); log-then-chain for forfeit (202 when this service has
 * no admin key to land it); log-only for appeals — `review.ts::decide`.
 *
 * The GETs are deliberately open: the log holds no secrets — pool, player,
 * action, criterion, signer key, timestamp, signature — and its whole point
 * is that decisions are re-checkable (`appeals.ts::verifyRow`). Routing is
 * a pure function over parsed bodies, same pattern as the entry server, so
 * the suite runs without sockets; the socket layer applies BR-005 hygiene
 * (CORS allowlist, rate limit, security headers) exactly as the entry
 * server does — the hand-rolled `access-control-allow-origin: *` this file
 * carried until Stage E is gone.
 */

import { createServer, type Server } from 'http';
import {
  RateLimiter,
  applyHygiene,
  type HygieneConfig,
} from '../../_shared/src/http-hygiene';
import {
  APPEAL_GROUNDS_MAX,
  appealDecisionRefusal,
  appealState,
  lodgeRefusal,
  lodgeRow,
  verifyAppealSubmission,
  type AppealSubmission,
} from './appeals';
import { verifyReviewSubmission, type ReviewerRegistry } from './auth';
import {
  decide,
  type Decision,
  type DecisionAction,
  type DecisionLog,
  type ReviewActions,
} from './review';

export interface ReviewServerDeps {
  registry: ReviewerRegistry;
  actions: ReviewActions;
  log: DecisionLog;
  /** Injectable clock (tests); defaults to Date.now. */
  now?: () => number;
  /** Trust X-Forwarded-For / Fly-Client-IP for the rate limiter's client
   * key — ONLY behind our own proxy (Fly). Default false. */
  trustProxyHeader?: boolean;
  /** BR-005 hygiene; default = the OFF/empty posture (unchanged wire). */
  hygiene?: HygieneConfig;
}

export interface ReviewRouteResult {
  status: number;
  body: unknown;
}

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ACTIONS: ReadonlySet<string> = new Set<DecisionAction>([
  'flag',
  'clear',
  'release',
  'forfeit',
  'appeal_upheld',
  'appeal_dismissed',
]);
const APPEAL_DECISIONS: ReadonlySet<string> = new Set(['appeal_upheld', 'appeal_dismissed']);

function parseAppeal(body: unknown): AppealSubmission | null {
  const b = body as Record<string, unknown>;
  if (
    !b ||
    typeof b.pool !== 'string' ||
    !B58.test(b.pool) ||
    typeof b.player !== 'string' ||
    !B58.test(b.player) ||
    typeof b.grounds !== 'string' ||
    b.grounds.trim().length === 0 ||
    b.grounds.length > APPEAL_GROUNDS_MAX ||
    typeof b.signedAt !== 'string' ||
    typeof b.signature !== 'string'
  ) {
    return null;
  }
  return {
    pool: b.pool,
    player: b.player,
    grounds: b.grounds,
    signedAt: b.signedAt,
    signature: b.signature,
  };
}

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
    const q = new URLSearchParams(queryString ?? '');
    const pool = q.get('pool');
    if (!pool || !B58.test(pool)) return { status: 400, body: { error: 'pool' } };
    const player = q.get('player');
    if (player !== null) {
      if (!B58.test(player)) return { status: 400, body: { error: 'player' } };
      return { status: 200, body: { decisions: await deps.log.listFor(pool, player) } };
    }
    return { status: 200, body: { decisions: await deps.log.list(pool) } };
  }

  if (route === '/appeals' && method === 'GET') {
    // The entry's appeal position, derived from the public log — what the
    // results page reads to decide whether to offer the form.
    const q = new URLSearchParams(queryString ?? '');
    const pool = q.get('pool');
    const player = q.get('player');
    if (!pool || !B58.test(pool)) return { status: 400, body: { error: 'pool' } };
    if (!player || !B58.test(player)) return { status: 400, body: { error: 'player' } };
    return { status: 200, body: appealState(await deps.log.listFor(pool, player)) };
  }

  if (route === '/appeals' && method === 'POST') {
    const appeal = parseAppeal(body);
    if (!appeal) return { status: 400, body: { error: 'malformed' } };
    const now = deps.now ?? Date.now;
    if (!verifyAppealSubmission(appeal, now())) {
      // Uniform: not the player's key, bad signature and stale look identical.
      return { status: 401, body: { error: 'unauthorized' } };
    }
    const thread = await deps.log.listFor(appeal.pool, appeal.player);
    const refusal = lodgeRefusal(thread, appeal.signedAt);
    if (refusal) return { status: 409, body: { error: refusal } };
    await decide(deps.actions, deps.log, lodgeRow(appeal));
    return { status: 204, body: null };
  }

  if (route === '/decisions' && method === 'POST') {
    const decision = parseDecision(body);
    if (!decision) return { status: 400, body: { error: 'malformed' } };
    const now = deps.now ?? Date.now;
    if (!verifyReviewSubmission(deps.registry, decision, now())) {
      // Uniform: unknown signer, bad signature and stale look identical.
      return { status: 401, body: { error: 'unauthorized' } };
    }
    if (APPEAL_DECISIONS.has(decision.action)) {
      // The published rule: an open appeal, decided by a DIFFERENT reviewer
      // from the one whose upheld flag is under appeal.
      const thread = await deps.log.listFor(decision.pool, decision.player);
      const refusal = appealDecisionRefusal(thread, decision.decidedBy);
      if (refusal) return { status: 409, body: { error: refusal } };
    }
    let outcome;
    try {
      outcome = await decide(deps.actions, deps.log, decision);
    } catch (e) {
      // The chain refused (or the RPC died): nothing was logged.
      return { status: 502, body: { error: 'action_failed', detail: String(e) } };
    }
    if (outcome === 'recorded_pending_admin') {
      // The reviewer's decision is on the record; the instruction is the
      // admin's to land (scripts/admin.ts forfeit-escrow).
      return {
        status: 202,
        body: { recorded: true, landed: false, next: 'admin lands forfeit_escrow' },
      };
    }
    return { status: 204, body: null };
  }

  if (route === '/decisions' || route === '/appeals') {
    return { status: 405, body: { error: 'method' } };
  }
  return { status: 404, body: { error: 'not found' } };
}

export function serveReviewApi(deps: ReviewServerDeps, port: number): Server {
  // BR-005 wiring, mirrored from the entry server: one hygiene decision per
  // request, BEFORE the router; the allowlist is the one CORS mechanism and
  // covers every response shape plus the browser preflight the POSTs need.
  const hygiene: HygieneConfig = deps.hygiene ?? {
    rateLimit: { enabled: false, requestsPerMinute: 1, burst: 1, retryAfterSeconds: 1 },
    cors: { allowedOrigins: [] },
    securityHeadersEnabled: false,
  };
  const limiter = new RateLimiter(hygiene.rateLimit);
  const server = createServer(async (req, res) => {
    const outcome = applyHygiene(
      {
        method: req.method,
        forwardedFor: deps.trustProxyHeader ? req.headers['x-forwarded-for'] : undefined,
        remoteAddress: req.socket.remoteAddress ?? undefined,
        flyClientIp: deps.trustProxyHeader ? req.headers['fly-client-ip'] : undefined,
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
    const baseHeaders = outcome.headers;

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
        if (out === null) res.writeHead(status, baseHeaders).end();
        else
          res
            .writeHead(status, { 'content-type': 'application/json', ...baseHeaders })
            .end(JSON.stringify(out));
      } catch {
        res
          .writeHead(500, { 'content-type': 'application/json', ...baseHeaders })
          .end(JSON.stringify({ error: 'internal' }));
      }
    });
  });
  server.listen(port);
  return server;
}
