/*
 * The bytes a reviewer signs to read a pool's detection report.
 *
 * WHY A SIGNED REQUEST AT ALL. The report is operator-token-only at the
 * review service (founder ruling D-E9: reported to the reviewer, never
 * acted on), and that token must never reach a browser bundle — there is no
 * `NEXT_PUBLIC_` form of it and there must not be. So the app proxies the
 * call from its own server, which holds the token. A proxy with no check of
 * its own would be an OPEN route onto per-player detection findings: it
 * would hand anyone who guessed the URL exactly what the operator token
 * exists to protect. The admin page's gate cannot help — it decides what a
 * browser draws, not what a server serves.
 *
 * So the caller proves the same thing the review service proves for a
 * decision: a wallet on the founder-maintained reviewer list signed this
 * request, recently. Same list (`config/reviewers.json`), same shape as
 * `canonicalReviewMessage`, and the same reason — a browser assertion is
 * not evidence.
 *
 * This message is verified by THIS APP'S route and by nothing else, so it
 * lives here rather than in backend/_shared: the review service never sees
 * it. Keep it that way — if the service ever verifies it, the definition
 * moves to the shared package so the two ends cannot drift.
 *
 * Pure and isomorphic: the client signs with it, the route verifies with it.
 */

export interface DetectionRequest {
  /** Pool address (base58). */
  pool: string;
  /** The reviewer's wallet address (base58) — must be on the list. */
  reviewer: string;
  /** ISO-8601 instant the request was signed. Bounds the replay window. */
  requestedAt: string;
}

/** How far out of step a request's clock may be before the route refuses. */
export const DETECTION_REQUEST_FRESHNESS_MS = 5 * 60_000;

/**
 * The canonical bytes. Human-readable, because a wallet shows it to the
 * person signing: they must be able to read what they are authorising.
 */
export function detectionRequestMessage(request: DetectionRequest): Uint8Array {
  const text = [
    'Blotto Cup detection report',
    `pool: ${request.pool}`,
    `reviewer: ${request.reviewer}`,
    `requested at: ${request.requestedAt}`,
    'This request reads a report. It decides nothing and changes nothing.',
  ].join('\n');
  return new TextEncoder().encode(text);
}

/** True when `requestedAt` parses and is within the freshness window of
 * `now`. Either direction: a clock ahead of ours is as stale as one behind. */
export function requestIsFresh(
  requestedAt: string,
  now: number,
  windowMs: number = DETECTION_REQUEST_FRESHNESS_MS
): boolean {
  const at = Date.parse(requestedAt);
  if (Number.isNaN(at)) return false;
  return Math.abs(now - at) <= windowMs;
}
