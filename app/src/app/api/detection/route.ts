/*
 * The detection report proxy (audit 2026-09-11, C-07 / A-18; founder ruling
 * D-E9 — the report goes TO THE REVIEWER and nothing acts on it).
 *
 * WHY A SERVER ROUTE EXISTS AT ALL. `GET /detection` on the review service
 * is operator-token-only, and that token must never reach a browser: there
 * is no `NEXT_PUBLIC_` form of it and there must not be one, because a
 * `NEXT_PUBLIC_` variable is compiled into every visitor's bundle. So the
 * token lives here, server-side, and the browser never sees it.
 *
 * WHY THE ROUTE HAS ITS OWN GATE. A proxy that simply forwarded would be an
 * open route onto per-player detection findings — it would hand anyone who
 * guessed the URL exactly what the operator token protects, which is worse
 * than not shipping the panel. The admin page's gate cannot help: it
 * decides what a browser draws, not what a server serves.
 *
 * So the caller proves what the review service makes a reviewer prove for a
 * decision — a wallet on the founder-maintained list
 * (`config/reviewers.json`, the SAME list `backend/detection/src/auth.ts`
 * reads) signed this request, recently. Three checks, all fail-closed:
 *
 *   1. the signature verifies as the claimed wallet's, over the canonical
 *      bytes (`detection-request.ts`);
 *   2. that wallet is on the reviewer list;
 *   3. the request is fresh (±5 minutes), so a captured body is not a
 *      permanent key.
 *
 * It is a POST, not a GET, because the request carries a signature: a
 * signed GET would put the reviewer's signature in query strings, server
 * logs and browser history.
 *
 * WHAT IT NEVER DOES. It does not act, recommend, or decide — it reads. The
 * `hardBlocks` list is passed through and LABELLED as reported-only by the
 * page, because under D-E9 nothing acts on it.
 */

import nacl from 'tweetnacl';
import reviewers from '@config/reviewers.json';
import { base58Decode } from '@blotto/shared/blotto-events';
import { detectionRequestMessage, requestIsFresh } from '@/app/admin/review/detection-request';

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

  let body: { pool?: unknown; reviewer?: unknown; requestedAt?: unknown; signature?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'malformed' }, { status: 400 });
  }
  const pool = typeof body.pool === 'string' ? body.pool : '';
  const reviewer = typeof body.reviewer === 'string' ? body.reviewer : '';
  const requestedAt = typeof body.requestedAt === 'string' ? body.requestedAt : '';
  const signatureB64 = typeof body.signature === 'string' ? body.signature : '';
  if (!B58.test(pool) || !B58.test(reviewer) || !requestedAt || !signatureB64) {
    return Response.json({ error: 'malformed' }, { status: 400 });
  }

  // 2. On the list. Checked before any crypto: the cheap test first, and a
  //    non-member learns nothing from the timing either way (the list is
  //    public — it ships in the bundle for the page's own door sign).
  if (!reviewers.members.includes(reviewer)) return REFUSED;
  // 3. Fresh — a captured body stops working in minutes, not never.
  if (!requestIsFresh(requestedAt, Date.now())) return REFUSED;

  // 1. The signature is the reviewer's, over these exact bytes.
  let verified = false;
  try {
    verified = nacl.sign.detached.verify(
      detectionRequestMessage({ pool, reviewer, requestedAt }),
      Uint8Array.from(Buffer.from(signatureB64, 'base64')),
      base58Decode(reviewer)
    );
  } catch {
    verified = false;
  }
  if (!verified) return REFUSED;

  let upstream: Response;
  try {
    upstream = await fetch(`${REVIEW_API}/detection?pool=${encodeURIComponent(pool)}`, {
      // The service compares the WHOLE header value against its token in
      // constant time (`operatorAuthorized`, backend/detection/src/server.ts)
      // — no "Bearer " prefix, or the comparison fails on length.
      headers: { authorization: OPERATOR_TOKEN },
      cache: 'no-store',
    });
  } catch {
    return Response.json({ error: 'unreachable' }, { status: 502 });
  }
  // Pass the service's own answer through unchanged — 404 "no report yet"
  // and 503 "not configured there" are facts the page says differently.
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
