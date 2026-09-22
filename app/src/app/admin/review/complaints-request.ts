/*
 * The bytes a reviewer signs to read the complaints QUEUE (2026-09-22).
 *
 * Modelled on `detection-request.ts` and for the same reason: the queue is
 * operator-token-only at the review service, that token must never reach a
 * browser bundle, so the app proxies the call from its own server — and a
 * proxy with no check of its own would be an open route onto the single most
 * sensitive body of text the product holds. Players' own words about their
 * own problems, readable by anyone who guessed the URL.
 *
 * WHY NOT REUSE `detectionRequestMessage`. Because a signature is only as
 * narrow as the bytes it covers. If one message authorised both reads, a
 * captured detection request — which a reviewer makes routinely, for a pool
 * whose findings are not especially private — would also open the complaints
 * queue. Distinct header, distinct authority, and neither signature verifies
 * as the other. The same discipline the two complaint messages follow
 * (`backend/detection/src/complaint-message.ts`).
 *
 * No pool field: the queue is not per-pool. That is also why the freshness
 * window is the whole of the replay protection here — there is no narrower
 * scope to bind the signature to.
 *
 * Verified by THIS APP'S route and by nothing else, so it lives here rather
 * than in backend/_shared; if the review service ever verifies it, the
 * definition moves so the two ends cannot drift.
 *
 * Pure and isomorphic: the client signs with it, the route verifies with it.
 */

export interface ComplaintsQueueRequest {
  /** The reviewer's wallet address (base58) — must be on the list. */
  reviewer: string;
  /** ISO-8601 instant the request was signed. Bounds the replay window. */
  requestedAt: string;
}

/** How far out of step a request's clock may be before the route refuses. */
export const COMPLAINTS_REQUEST_FRESHNESS_MS = 5 * 60_000;

/**
 * The canonical bytes. Human-readable, because a wallet shows this to the
 * person signing and they must be able to read what they are authorising —
 * including, in the last line, that it is other people's words they are
 * about to read.
 */
export function complaintsQueueMessage(request: ComplaintsQueueRequest): Uint8Array {
  const text = [
    'Blotto Cup complaints queue',
    `reviewer: ${request.reviewer}`,
    `requested at: ${request.requestedAt}`,
    'This request reads complaints players have sent. It decides nothing and changes nothing.',
  ].join('\n');
  return new TextEncoder().encode(text);
}

/** True when `requestedAt` parses and is within the freshness window of
 * `now`. Either direction: a clock ahead of ours is as stale as one behind. */
export function queueRequestIsFresh(
  requestedAt: string,
  now: number,
  windowMs: number = COMPLAINTS_REQUEST_FRESHNESS_MS
): boolean {
  const at = Date.parse(requestedAt);
  if (Number.isNaN(at)) return false;
  return Math.abs(now - at) <= windowMs;
}
