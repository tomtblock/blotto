/*
 * The complaints QUEUE proxy (2026-09-22) — the desk's read of what players
 * have sent, and the reason the operator write path can exist at all.
 *
 * WHY A SERVER ROUTE. `GET /complaints/open` on the review service is
 * operator-token-only, and that token must never reach a browser: a
 * `NEXT_PUBLIC_` variable is compiled into every visitor's bundle, so there
 * is no public form of it and there must not be one. The token lives here.
 *
 * WHY THE ROUTE HAS ITS OWN GATE. A proxy that simply forwarded would be an
 * open route onto every complaint in the system — players' own words about
 * their own problems, which is the most sensitive text this product holds
 * and worse to leak than anything the detection proxy guards. The admin
 * page's gate cannot help: it decides what a browser draws, not what a
 * server serves.
 *
 * So the caller proves what the review service makes a reviewer prove for a
 * decision — a wallet on the founder-maintained list (`config/reviewers.json`,
 * the SAME list `backend/detection/src/auth.ts` reads) signed this request,
 * recently. Three checks, all fail-closed, in the same order and with the
 * same single refusal shape as `api/detection/route.ts`.
 *
 * It is a POST for both reads and writes, not a GET, because the request
 * carries a signature: a signed GET would put the reviewer's signature in
 * query strings, server logs and browser history.
 *
 * ── THE WRITE HALF ────────────────────────────────────────────────────────
 *
 * Answering a complaint is NOT proxied. It goes from the browser straight to
 * the review service, exactly as a decision does, because the review service
 * verifies the reviewer's own signature over the canonical answer message
 * and that signature is the whole point: it is what makes the stored
 * `decided_by` evidence rather than an assertion this proxy would be
 * vouching for. A proxy in that path could only weaken it — the service
 * would then be trusting the app about who answered.
 *
 * WHAT THIS NEVER DOES. It reads. It cannot answer, acknowledge, resolve, or
 * change any complaint, and it holds no key that could.
 */

import nacl from 'tweetnacl';
import reviewers from '@config/reviewers.json';
import { base58Decode } from '@blotto/shared/blotto-events';
import {
  complaintsQueueMessage,
  queueRequestIsFresh,
} from '@/app/admin/review/complaints-request';

/** Server-only: the review service's operator token. NEVER NEXT_PUBLIC_. */
const OPERATOR_TOKEN = process.env.REVIEW_OPERATOR_TOKEN;
/** The review service's base URL. Public already (the page POSTs decisions
 * to it directly), so the public variable is reused rather than doubled. */
const REVIEW_API = process.env.NEXT_PUBLIC_REVIEW_API_URL;

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** One refusal shape for every failed check: an outsider learns only that
 * they were refused, never which check refused them. */
const REFUSED = Response.json({ error: 'unauthorized' }, { status: 401 });

export async function POST(request: Request): Promise<Response> {
  if (!OPERATOR_TOKEN || !REVIEW_API) {
    // Fail closed and say which end is unconfigured — an operator reads
    // this, and it never reveals anything to an unauthorised caller.
    return Response.json({ error: 'not_configured' }, { status: 503 });
  }

  let body: { reviewer?: unknown; requestedAt?: unknown; signature?: unknown; limit?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'malformed' }, { status: 400 });
  }
  const reviewer = typeof body.reviewer === 'string' ? body.reviewer : '';
  const requestedAt = typeof body.requestedAt === 'string' ? body.requestedAt : '';
  const signatureB64 = typeof body.signature === 'string' ? body.signature : '';
  if (!B58.test(reviewer) || !requestedAt || !signatureB64) {
    return Response.json({ error: 'malformed' }, { status: 400 });
  }

  // 2. On the list. Checked before any crypto: the cheap test first, and a
  //    non-member learns nothing from the timing either way (the list is
  //    public — it ships in the bundle for the page's own door sign).
  if (!reviewers.members.includes(reviewer)) return REFUSED;
  // 3. Fresh — a captured body stops working in minutes, not never. It is
  //    the whole of the replay protection here: unlike a detection request
  //    there is no pool to bind the signature to.
  if (!queueRequestIsFresh(requestedAt, Date.now())) return REFUSED;

  // 1. The signature is the reviewer's, over these exact bytes.
  let verified = false;
  try {
    verified = nacl.sign.detached.verify(
      complaintsQueueMessage({ reviewer, requestedAt }),
      Uint8Array.from(Buffer.from(signatureB64, 'base64')),
      base58Decode(reviewer)
    );
  } catch {
    verified = false;
  }
  if (!verified) return REFUSED;

  // The service bounds the limit itself and answers 400 on a bad one; this
  // passes a requested value through only when it is a plain integer, so a
  // malformed query never reaches the upstream URL.
  const limit = Number.isInteger(body.limit) ? String(body.limit) : '';
  const query = limit === '' ? '' : `?limit=${encodeURIComponent(limit)}`;

  let upstream: Response;
  try {
    upstream = await fetch(`${REVIEW_API}/complaints/open${query}`, {
      // The service compares the WHOLE header value against its token in
      // constant time (`operatorAuthorized`, backend/detection/src/server.ts)
      // — no "Bearer " prefix, or the comparison fails on length.
      headers: { authorization: OPERATOR_TOKEN },
      cache: 'no-store',
    });
  } catch {
    return Response.json({ error: 'unreachable' }, { status: 502 });
  }
  // Pass the service's own answer through unchanged — a 503 "not configured
  // there" is a different fact from this route's own 503, and the page says
  // them differently.
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
