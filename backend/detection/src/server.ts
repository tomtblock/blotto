/**
 * The review service's HTTP face (C10; appeals and hygiene since Phase 2
 * Stage E) — the server behind the admin review page's POSTs and the
 * results page's appeal form:
 *
 *   POST /decisions  { pool, player, action, criterion, decidedBy,
 *                      decidedAt, signature }
 *                    → 204 applied | 200 applied, log write failed
 *                    | 202 forfeit recorded, admin lands it
 *                    | 400 / 401 / 409 / 429 / 502
 *   POST /appeals    { pool, player, grounds, signedAt, signature }
 *                    → 204 | 400 / 401 / 409       (player-signed)
 *   POST /complaints { reference, category, wallet?, pool?, text,
 *                      signedAt?, signature? }
 *                    → 204 | 400 / 401 / 409 / 503 (signed for a decision or
 *                      a payment; unsigned allowed otherwise, so a player
 *                      locked out of their wallet can still reach us)
 *   GET  /complaints?ref=<BC-XXXXXXXX>[&wallet=<wallet>]
 *                    → the complaint's derived status | 404
 *   GET  /decisions?pool=<pda>[&player=<wallet>]  → { decisions }
 *   GET  /appeals?pool=<pda>&player=<wallet>      → the entry's appeal state
 *   GET  /pending?pool=<pda>   → upheld forfeits whose chain instruction has
 *                                not landed (audit C-07)
 *   GET  /detection?pool=<pda> → the latest detection report for the pool.
 *                                OPERATOR-TOKEN ONLY (ruling D-E9)
 *
 * Every decision POST is wallet-signed by a configured reviewer (auth.ts);
 * the one uniform 401 covers unknown signer, bad signature and stale
 * timestamp alike. An appeal POST is signed by the entry's own player, and
 * its 401 DOES say which of the two causes it was (D-33 — see below). The
 * 409s are RULE refusals for a verified signer (nothing to appeal, already
 * lodged, window closed, no open appeal, same reviewer, a replayed
 * signature, and every state precondition in `preconditions.ts`) and say
 * which — they leak nothing an outsider could not read from the public log
 * or from the chain.
 *
 * ── WHAT THE 2026-09-11 AUDIT CHANGED HERE ────────────────────────────────
 *
 * B-23 — REPLAY. `GET /decisions` publishes every field of an accepted
 * decision, signature included, on an open route, and the signature was
 * valid for five minutes either side of its instant. The service was
 * therefore publishing complete, ready-to-send replay material for its own
 * authorization: capture a `clear`, re-send it after the reviewer flags the
 * entry again, and the flag comes off. Closed by refusing any submission
 * whose signature is ALREADY ON THE RECORD for that entry. Ed25519 is
 * deterministic, so the signature is a nonce that needs no column: the same
 * signer, entry, action, criterion and instant always produce the same 64
 * bytes, and their second arrival is a replay by construction.
 *   Rejected: (a) a nonce field inside the canonical message plus a nonce
 * table — strictly stronger, since it would also cover a decision whose log
 * write failed, but it changes the signed message, so every client must ship
 * the new bytes in the same release or no decision verifies at all, and it
 * adds a table that needs its own sweeper; (b) shortening the freshness
 * window — narrows the hole, never closes it, and makes an honest reviewer
 * on a slightly wrong clock fail. What the log-based check buys is exactly
 * what the finding names: the published material stops being sufficient to
 * replay, because being published is what spends it.
 *
 * B-25 — AUTHENTICATION USED AS AUTHORIZATION. One member key could flag or
 * release any entry in any pool with no state check, no second party and no
 * budget. Now: the action must be legal for the entry and for the pool
 * (`preconditions.ts`, mirroring the program's own `require!` lines), and a
 * reviewer's decisions per window are bounded and alerted on (`budget.ts`;
 * the NUMBER is the founder's to ratify). The second-signer half needs a
 * second person and is not this batch's.
 *
 * B-24 / C-07 — HONEST OUTCOMES. A log write that failed AFTER the chain
 * action landed used to answer 502 `action_failed` for work that had
 * executed, inviting the reviewer to retry something already done; it now
 * answers 200 saying applied-but-not-logged, and alerts. A forfeit whose
 * chain call is refused used to swallow the error whole; the reason now
 * reaches the response and an alert, so "this service holds no admin key"
 * (routine) is distinguishable from "the RPC is down" (not).
 *
 * B-35 — every request leaves one structured line, including failed reviewer
 * authentication, which left no trace at all on the one internet-facing
 * service that holds the settlement signing key. No signature, no criterion
 * and no whole address is ever written (the repo's truncation convention,
 * `backend/packet/src/signer-select.ts` and `service.ts`).
 *
 * B-46 — the rate limiter's bucket map is swept on a timer.
 *
 * Apply-then-log for flag/clear/release; log-then-chain for forfeit (202
 * when this service has no admin key to land it); log-only for appeals —
 * `review.ts::decide`.
 *
 * The GETs are deliberately open — the log holds no secrets and its whole
 * point is that decisions are re-checkable (`appeals.ts::verifyRow`) — with
 * ONE exception: `/detection` names players a signal fired on before any
 * human has looked at them, and is operator-token only. Routing is a pure
 * function over parsed bodies, same pattern as the entry server, so the
 * suite runs without sockets; the socket layer applies BR-005 hygiene (CORS
 * allowlist, rate limit, security headers) exactly as the entry server does.
 */

import { createServer, type Server } from 'http';
import { timingSafeEqual } from 'crypto';
import {
  RateLimiter,
  applyHygiene,
  clientKeyFrom,
  startBucketSweeper,
  type HygieneConfig,
} from '../../_shared/src/http-hygiene';
import { ALERT, METRIC } from '../../_shared/src/metrics';
import type { Monitor } from '../../_shared/src/monitor';
import { ipPrefix, short } from '../../_shared/src/short';
import {
  APPEAL_GROUNDS_MAX,
  appealDecisionRefusal,
  appealState,
  appealSubmissionRefusal,
  lodgeRefusal,
  lodgeRow,
  type AppealSubmission,
} from './appeals';
import { reviewSubmissionRefusal, type ReviewerRegistry } from './auth';
import {
  COMPLAINT_CATEGORY_KEYS,
  COMPLAINT_TEXT_MAX,
  complaintRuleRefusal,
  complaintSignatureRefusal,
  complaintStatus,
  lodgedRow,
  mayReadComplaint,
  type ComplaintCategory,
  type ComplaintStore,
  type ComplaintSubmission,
} from './complaints';
import { COMPLAINT_REFERENCE_PATTERN } from './complaint-message';
import {
  DEFAULT_REVIEWER_BUDGET,
  budgetRetryAfterSeconds,
  budgetWindowStart,
  type ReviewerBudget,
} from './budget';
import { preconditionRefusal } from './preconditions';
import type { DetectionReportStore } from './reports';
import {
  decide,
  errorText,
  type Decision,
  type DecisionAction,
  type DecisionLog,
  type ReviewActions,
} from './review';

/**
 * One structured line per request. Same shape as the daemon's logger —
 * `(stage, detail)` — so a deployment can route both the same way.
 */
export type RequestLogger = (stage: string, detail: Record<string, unknown>) => void;

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
  /** Where the audit line goes. Default: this service's stdout. */
  logger?: RequestLogger;
  /** Metrics and alerts. Absent = no monitoring (offline suites). */
  monitor?: Monitor;
  /** Per-reviewer action budget (B-25). Default {@link DEFAULT_REVIEWER_BUDGET}. */
  budget?: ReviewerBudget;
  /** The detection report surface (A-18). Absent ⇒ `/detection` is 503. */
  reports?: DetectionReportStore;
  /**
   * The complaints record (2026-09-19). Absent ⇒ both `/complaints` routes
   * answer 503 `not_configured`, which the form renders as its own distinct
   * state — an absent service must never look like a refused complaint.
   */
  complaints?: ComplaintStore;
  /** Shared operator secret for `/detection`. Absent/empty ⇒ 503, fail-closed. */
  operatorToken?: string;
  /**
   * Overrides for the limiter's bucket sweeper (B-46) — a seam for the spec
   * that proves the socket layer actually starts one. Production passes
   * nothing and takes the documented defaults.
   */
  sweep?: {
    intervalMs?: number;
    idleMs?: number;
    setIntervalImpl?: (handler: () => void, ms: number) => unknown;
    clearIntervalImpl?: (handle: unknown) => void;
  };
}

/** What the socket layer knows about a request that the router cannot see. */
export interface RequestContext {
  /** The `authorization` header, verbatim. */
  authorization?: string;
  /** The limiter's resolved client key — logged truncated, never whole. */
  clientKey?: string;
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
/** The kinds that take a chain action and therefore have chain preconditions. */
const CHAIN_ACTIONS: ReadonlySet<string> = new Set(['flag', 'clear', 'release', 'forfeit']);

// `short` (6…4) and `ipPrefix` (two octets, or one hextet) are the one shared
// rule for anything that reaches a log or an alert — `_shared/src/short.ts`
// since 2026-09-16. This file carried its own copies until then, and its two
// alerts below bypassed them with whole wallets.

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

/**
 * Parse a complaint submission. Shape only — the RULES (which categories
 * need a signature, whether the reference is free) are `complaints.ts`, and
 * the signature is checked after this.
 *
 * An absent `wallet`, `pool`, `signedAt` or `signature` is legitimate: those
 * four are what an unsigned submission omits. A PRESENT one must be
 * well-formed, so a garbled address cannot be stored as though it were
 * proven.
 */
function parseComplaint(body: unknown): ComplaintSubmission | null {
  const b = body as Record<string, unknown>;
  if (
    !b ||
    typeof b.reference !== 'string' ||
    !COMPLAINT_REFERENCE_PATTERN.test(b.reference) ||
    typeof b.category !== 'string' ||
    !COMPLAINT_CATEGORY_KEYS.includes(b.category as ComplaintCategory) ||
    typeof b.text !== 'string' ||
    b.text.trim().length === 0 ||
    b.text.length > COMPLAINT_TEXT_MAX
  ) {
    return null;
  }
  const optionalString = (v: unknown, pattern?: RegExp): string | null | undefined => {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'string') return undefined;
    if (pattern && !pattern.test(v)) return undefined;
    return v;
  };
  const wallet = optionalString(b.wallet, B58);
  const pool = optionalString(b.pool, B58);
  const signedAt = optionalString(b.signedAt);
  const signature = optionalString(b.signature);
  if (wallet === undefined || pool === undefined || signedAt === undefined || signature === undefined) {
    return null;
  }
  return {
    reference: b.reference,
    category: b.category as ComplaintCategory,
    wallet,
    pool,
    text: b.text,
    signedAt,
    signature,
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

/** Constant-time compare of the operator token, as the indexer's ingress does. */
function operatorAuthorized(header: string | undefined, token: string | undefined): boolean {
  if (!token || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Is this exact signature already on this entry's record? (B-23.) A
 * deterministic signature over an unchanged message is the same bytes, so a
 * second arrival of a signature the log already holds is a replay — and the
 * published row is the proof that it is spent.
 */
function isReplay(thread: readonly Decision[], signature: string): boolean {
  return thread.some((r) => r.signature === signature);
}

export async function handleReviewRoute(
  deps: ReviewServerDeps,
  method: string,
  path: string,
  body: unknown,
  ctx: RequestContext = {}
): Promise<ReviewRouteResult> {
  const [route, queryString] = path.split('?', 2);
  const logger = deps.logger ?? defaultLogger;
  const client = ipPrefix(ctx.clientKey);
  const line = (result: ReviewRouteResult, detail: Record<string, unknown> = {}): ReviewRouteResult => {
    // ONE line per request (B-35). Never a signature, never a criterion,
    // never a whole address.
    logger('request', { method, route, status: result.status, client, ...detail });
    return result;
  };

  // E5: the deployment liveness probe. Not logged — a platform health check
  // every few seconds would drown the lines that matter.
  if (route === '/health' && method === 'GET') {
    return { status: 200, body: { ok: true, service: 'review' } };
  }

  if (route === '/decisions' && method === 'GET') {
    const q = new URLSearchParams(queryString ?? '');
    const pool = q.get('pool');
    if (!pool || !B58.test(pool)) return line({ status: 400, body: { error: 'pool' } });
    const player = q.get('player');
    if (player !== null) {
      if (!B58.test(player)) return line({ status: 400, body: { error: 'player' } });
      return line(
        { status: 200, body: { decisions: await deps.log.listFor(pool, player) } },
        { pool: short(pool), player: short(player) }
      );
    }
    return line(
      { status: 200, body: { decisions: await deps.log.list(pool) } },
      { pool: short(pool) }
    );
  }

  if (route === '/appeals' && method === 'GET') {
    // The entry's appeal position, derived from the public log — what the
    // results page reads to decide whether to offer the form.
    const q = new URLSearchParams(queryString ?? '');
    const pool = q.get('pool');
    const player = q.get('player');
    if (!pool || !B58.test(pool)) return line({ status: 400, body: { error: 'pool' } });
    if (!player || !B58.test(player)) return line({ status: 400, body: { error: 'player' } });
    return line(
      { status: 200, body: appealState(await deps.log.listFor(pool, player)) },
      { pool: short(pool), player: short(player) }
    );
  }

  if (route === '/pending' && method === 'GET') {
    // C-07's visibility half. An upheld forfeit is LOGGED here and LANDED by
    // an admin transaction later; in between, the share sits in the vault
    // under a decision the chain does not yet carry. That gap used to exist
    // nowhere an operator could see it: the 202 was a response to one POST
    // and nothing kept the list. The daemon's review clock already refuses
    // to release such a share and alerts when the window closes (D-03); this
    // is the same state as a read, so the desk can see it before then.
    const q = new URLSearchParams(queryString ?? '');
    const pool = q.get('pool');
    if (!pool || !B58.test(pool)) return line({ status: 400, body: { error: 'pool' } });
    const rows = await deps.log.list(pool);
    const players = [...new Set(rows.map((r) => r.player))];
    const pending: Array<Record<string, unknown>> = [];
    for (const player of players) {
      const forfeit = appealState(rows.filter((r) => r.player === player)).forfeit;
      if (!forfeit) continue;
      const entry = await deps.actions.entryState(pool, player);
      if (entry !== null && entry.forfeited) continue;
      pending.push({
        player,
        decidedBy: forfeit.decidedBy,
        decidedAt: forfeit.decidedAt,
        criterion: forfeit.criterion,
        entryFound: entry !== null,
      });
    }
    return line(
      { status: 200, body: { pool, pending } },
      { pool: short(pool), pending: pending.length }
    );
  }

  if (route === '/detection' && method === 'GET') {
    // A-18 / ruling D-E9: the reviewer's page reads this before the review
    // window closes. Operator-token only, and fail-closed — an unset token
    // is a 503, never an open route.
    if (!deps.reports || !deps.operatorToken) {
      return line({ status: 503, body: { error: 'not_configured' } });
    }
    if (!operatorAuthorized(ctx.authorization, deps.operatorToken)) {
      return line({ status: 401, body: { error: 'unauthorized' } }, { refusal: 'operator_token' });
    }
    const q = new URLSearchParams(queryString ?? '');
    const pool = q.get('pool');
    if (!pool || !B58.test(pool)) return line({ status: 400, body: { error: 'pool' } });
    const stored = await deps.reports.latest(pool);
    if (!stored) {
      return line({ status: 404, body: { error: 'no_report', pool } }, { pool: short(pool) });
    }
    return line(
      {
        status: 200,
        body: {
          pool: stored.pool,
          poolId: stored.poolId,
          producedAt: stored.producedAt,
          findings: stored.report.findings,
          reviewRecommended: stored.report.reviewRecommended,
          // Reported, never acted on: detection is manual (D-E9). The list is
          // what R11 WOULD hard-block if the founder ever turned that on.
          hardBlocks: stored.report.hardBlocks,
        },
      },
      { pool: short(pool), findings: stored.report.findings.length }
    );
  }

  if (route === '/appeals' && method === 'POST') {
    const appeal = parseAppeal(body);
    if (!appeal) return line({ status: 400, body: { error: 'malformed' } });
    const now = deps.now ?? Date.now;
    const refusal = appealSubmissionRefusal(appeal, now());
    if (refusal !== null) {
      // D-33: the player is told WHICH of the two it was. A clock a few
      // minutes out is the appellant's to fix and they cannot fix it if we
      // call it a bad signature; and this route leaks nothing by saying so —
      // the submitter signs with their own key over their own wallet and
      // pool. (The reviewer route above stays uniform, deliberately.)
      const cause = refusal === 'clock_skew' || refusal === 'bad_timestamp' ? 'clock_skew' : 'signature';
      return line(
        { status: 401, body: { error: 'unauthorized', reason: cause } },
        { pool: short(appeal.pool), player: short(appeal.player), refusal }
      );
    }
    const thread = await deps.log.listFor(appeal.pool, appeal.player);
    if (isReplay(thread, appeal.signature)) {
      return line(
        { status: 409, body: { error: 'already_recorded' } },
        { pool: short(appeal.pool), player: short(appeal.player), refusal: 'replay' }
      );
    }
    const ruleRefusal = lodgeRefusal(thread, appeal.signedAt);
    if (ruleRefusal) {
      return line(
        { status: 409, body: { error: ruleRefusal } },
        { pool: short(appeal.pool), player: short(appeal.player), refusal: ruleRefusal }
      );
    }
    await decide(deps.actions, deps.log, lodgeRow(appeal));
    return line(
      { status: 204, body: null },
      { pool: short(appeal.pool), player: short(appeal.player), action: 'appeal_lodged' }
    );
  }

  if (route === '/complaints' && method === 'GET') {
    // The player's handle on their own complaint. Every refusal is the SAME
    // 404: "wrong wallet" would confirm the reference exists, and a
    // reference is guessable in a way a pool PDA is not.
    if (!deps.complaints) return line({ status: 503, body: { error: 'not_configured' } });
    const q = new URLSearchParams(queryString ?? '');
    const reference = q.get('ref');
    if (!reference || !COMPLAINT_REFERENCE_PATTERN.test(reference)) {
      return line({ status: 400, body: { error: 'ref' } });
    }
    const wallet = q.get('wallet');
    if (wallet !== null && !B58.test(wallet)) return line({ status: 400, body: { error: 'wallet' } });
    const thread = await deps.complaints.listFor(reference);
    const status = mayReadComplaint(thread, wallet) ? complaintStatus(thread) : null;
    if (status === null) {
      return line({ status: 404, body: { error: 'not_found' } }, { reference });
    }
    return line({ status: 200, body: status }, { reference, complaintStatus: status.status });
  }

  if (route === '/complaints' && method === 'POST') {
    // An ABSENT store is 503 `not_configured`, never a refusal: the form
    // renders the two as different states on purpose, because "we did not
    // receive your complaint" and "we refused your complaint" are different
    // statements and a player must not be told the second when the first is
    // true (the C-04 lesson, applied before it can bite).
    if (!deps.complaints) return line({ status: 503, body: { error: 'not_configured' } });
    const complaint = parseComplaint(body);
    if (!complaint) return line({ status: 400, body: { error: 'malformed' } });
    const now = deps.now ?? Date.now;

    const signatureRefusal = complaintSignatureRefusal(complaint, now());
    if (signatureRefusal !== null) {
      // D-33's reasoning, same as the appeal route: a device clock a few
      // minutes out is the complainant's to fix and they cannot fix it if we
      // call it a bad signature. Nothing leaks — they signed with their own
      // key over a message naming their own wallet.
      const cause =
        signatureRefusal === 'clock_skew' || signatureRefusal === 'bad_timestamp'
          ? 'clock_skew'
          : 'signature';
      return line(
        { status: 401, body: { error: 'unauthorized', reason: cause } },
        { reference: complaint.reference, refusal: signatureRefusal }
      );
    }

    const existing = await deps.complaints.listFor(complaint.reference);
    const ruleRefusal = complaintRuleRefusal(complaint, existing);
    if (ruleRefusal !== null) {
      // `malformed` is a 400 wherever it is discovered; the other two are
      // rule refusals for a submission whose shape and signature are fine.
      const status = ruleRefusal === 'malformed' ? 400 : 409;
      return line(
        { status, body: { error: ruleRefusal } },
        { reference: complaint.reference, refusal: ruleRefusal }
      );
    }

    await deps.complaints.append(lodgedRow(complaint, new Date(now()).toISOString()));
    return line(
      { status: 204, body: null },
      {
        reference: complaint.reference,
        category: complaint.category,
        // Whether it was signed, never the signature itself or the text.
        signed: complaint.signature !== null && complaint.signature !== undefined,
      }
    );
  }

  if (route === '/decisions' && method === 'POST') {
    const decision = parseDecision(body);
    if (!decision) return line({ status: 400, body: { error: 'malformed' } });
    const now = deps.now ?? Date.now;
    const where = {
      action: decision.action,
      reviewer: short(decision.decidedBy),
      pool: short(decision.pool),
      player: short(decision.player),
    };
    const authRefusal = reviewSubmissionRefusal(deps.registry, decision, now());
    if (authRefusal !== null) {
      // Uniform to the CALLER — unknown signer, bad signature and stale look
      // identical, so the endpoint is not a member-list oracle. Named in the
      // LOG, which the caller cannot reach (B-35).
      deps.monitor?.recordEvent(METRIC.review.decisionRefused, { reason: 'unauthorized' });
      return line({ status: 401, body: { error: 'unauthorized' } }, { ...where, refusal: authRefusal });
    }

    const thread = await deps.log.listFor(decision.pool, decision.player);
    if (isReplay(thread, decision.signature)) {
      // B-23. Honest for the accidental case too: an honest retry of a
      // request whose response was lost is told the decision is on the
      // record, which is the truth and is what it needed to know.
      deps.monitor?.recordEvent(METRIC.review.decisionRefused, { reason: 'replay' });
      return line({ status: 409, body: { error: 'already_recorded' } }, { ...where, refusal: 'replay' });
    }

    if (APPEAL_DECISIONS.has(decision.action)) {
      // The published rule: an open appeal, decided by a DIFFERENT reviewer
      // from the one whose upheld flag is under appeal.
      const refusal = appealDecisionRefusal(thread, decision.decidedBy);
      if (refusal) {
        deps.monitor?.recordEvent(METRIC.review.decisionRefused, { reason: 'rule' });
        return line({ status: 409, body: { error: refusal } }, { ...where, refusal });
      }
    }

    // B-25, the budget. Before the chain reads: a key being scripted should
    // not get free RPC round trips out of us either.
    const budget = deps.budget ?? DEFAULT_REVIEWER_BUDGET;
    const spent = await deps.log.countBy(decision.decidedBy, budgetWindowStart(now(), budget));
    if (spent >= budget.actions) {
      deps.monitor?.recordEvent(METRIC.review.decisionRefused, { reason: 'budget' });
      deps.monitor?.alert(ALERT.review.reviewerBudgetSpent, {
        reviewer: short(decision.decidedBy),
        spent,
        budget: budget.actions,
        windowMs: budget.windowMs,
      });
      return line(
        {
          status: 429,
          body: {
            error: 'budget_exceeded',
            retryAfterSeconds: budgetRetryAfterSeconds(budget),
          },
        },
        { ...where, refusal: 'budget', spent }
      );
    }

    // B-25, the state preconditions. Mirrors the program's own `require!`
    // lines, so this can only refuse earlier than the chain would, never
    // permit something it would not.
    if (CHAIN_ACTIONS.has(decision.action)) {
      let poolState;
      let entryState;
      try {
        poolState = await deps.actions.poolState(decision.pool);
        entryState = await deps.actions.entryState(decision.pool, decision.player);
      } catch (e) {
        // The chain could not be read, so legality is unknown. Refusing is
        // the only safe answer: acting anyway is the finding.
        return line(
          { status: 502, body: { error: 'state_unreadable', detail: errorText(e) } },
          { ...where, refusal: 'state_unreadable' }
        );
      }
      const refusal = preconditionRefusal(decision.action, poolState, entryState);
      if (refusal) {
        deps.monitor?.recordEvent(METRIC.review.decisionRefused, { reason: 'precondition' });
        return line(
          { status: 409, body: { error: refusal, poolState } },
          { ...where, refusal, poolState }
        );
      }
    }

    let outcome;
    try {
      outcome = await decide(deps.actions, deps.log, decision);
    } catch (e) {
      // The chain refused (or the RPC died): nothing was logged.
      return line(
        { status: 502, body: { error: 'action_failed', detail: errorText(e) } },
        { ...where, refusal: 'action_failed' }
      );
    }

    deps.monitor?.recordEvent(METRIC.review.decision, { action: decision.action });

    if (outcome.kind === 'applied_not_logged') {
      // B-24. The chain action LANDED. Saying 502 here would tell the
      // reviewer their decision failed and invite them to repeat work that
      // is already irreversible; the log write is what failed, and that is
      // an operator problem, loudly.
      deps.monitor?.alert(ALERT.review.decisionNotLogged, {
        // The same truncated identifiers as the request log (2026-09-16): an
        // alert can be forwarded off-box, and this one carried the whole wallet.
        ...where,
        decidedAt: decision.decidedAt,
        error: outcome.logError,
      });
      return line(
        {
          status: 200,
          body: {
            applied: true,
            logged: false,
            error: 'log_write_failed',
            detail: outcome.logError,
            next: 'the chain action landed; the decision is NOT in the published log',
          },
        },
        { ...where, outcome: 'applied_not_logged' }
      );
    }

    if (outcome.kind === 'recorded_pending_admin') {
      // The reviewer's decision is on the record; the instruction is the
      // admin's to land (scripts/admin.ts forfeit-escrow). C-07: the chain
      // refusal is reported rather than swallowed, and it alerts — "no admin
      // key here" is routine, anything else is not, and the operator is the
      // only one who can tell which from the text.
      deps.monitor?.alert(ALERT.review.forfeitNotLanded, {
        ...where,
        decidedAt: decision.decidedAt,
        chainError: outcome.chainError,
      });
      return line(
        {
          status: 202,
          body: {
            recorded: true,
            landed: false,
            next: 'admin lands forfeit_escrow',
            detail: outcome.chainError,
          },
        },
        { ...where, outcome: 'recorded_pending_admin' }
      );
    }

    return line({ status: 204, body: null }, { ...where, outcome: 'applied' });
  }

  if (
    route === '/decisions' ||
    route === '/appeals' ||
    route === '/pending' ||
    route === '/detection' ||
    route === '/complaints'
  ) {
    return line({ status: 405, body: { error: 'method' } });
  }
  return line({ status: 404, body: { error: 'not found' } });
}

const defaultLogger: RequestLogger = (stage, detail) =>
  console.log(`review: ${stage}`, JSON.stringify(detail));

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
  // B-46: every client address is a bucket key, so an unswept map is an
  // unbounded leak on a public service — the defence becomes the vector.
  // The sweeper's timer is unref'ed and no timer is started at all when the
  // limiter is off, so the default posture is unchanged.
  const sweeper = startBucketSweeper(limiter, hygiene.rateLimit, deps.sweep ?? {});
  const logger = deps.logger ?? defaultLogger;
  const server = createServer(async (req, res) => {
    const forwardedFor = deps.trustProxyHeader ? req.headers['x-forwarded-for'] : undefined;
    const flyClientIp = deps.trustProxyHeader ? req.headers['fly-client-ip'] : undefined;
    const remoteAddress = req.socket.remoteAddress ?? undefined;
    const clientKey = clientKeyFrom(forwardedFor, remoteAddress, flyClientIp, deps.trustProxyHeader === true);
    const outcome = applyHygiene(
      {
        method: req.method,
        forwardedFor,
        remoteAddress,
        flyClientIp,
        origin: req.headers.origin,
        trustProxy: deps.trustProxyHeader === true,
      },
      hygiene,
      limiter
    );
    if (outcome.kind === 'preflight') {
      res.writeHead(outcome.status, outcome.headers).end();
      return;
    }
    if (outcome.kind === 'rate_limited') {
      // Logged here because it never reaches the router: a burst of these
      // from one prefix is the shape of an attack on this service.
      logger('rate_limited', {
        method: req.method ?? '',
        route: (req.url ?? '/').split('?')[0],
        status: outcome.status,
        client: ipPrefix(clientKey),
      });
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
          body,
          { authorization: req.headers.authorization, clientKey }
        );
        if (out === null) res.writeHead(status, baseHeaders).end();
        else
          res
            .writeHead(status, { 'content-type': 'application/json', ...baseHeaders })
            .end(JSON.stringify(out));
      } catch (e) {
        // The router threw: a store or the chain client failed in a way no
        // route handled. Logged (B-35) — it used to be the one outcome this
        // service produced in complete silence.
        logger('handler_threw', {
          method: req.method ?? '',
          route: (req.url ?? '/').split('?')[0],
          status: 500,
          client: ipPrefix(clientKey),
          error: errorText(e),
        });
        res
          .writeHead(500, { 'content-type': 'application/json', ...baseHeaders })
          .end(JSON.stringify({ error: 'internal' }));
      }
    });
  });
  server.on('close', () => sweeper.stop());
  server.listen(port);
  return server;
}
