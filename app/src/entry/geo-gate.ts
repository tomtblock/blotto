/*
 * The client territory pre-flight (D-B3): ask the entry service's `/geo`
 * verdict BEFORE rendering anything that can take money. FAIL-CLOSED at
 * every edge — only an explicit `{ allowed: true }` opens the pay path.
 *
 * Two ways to be closed, and the difference is the point (founder report,
 * 2026-08-28: "I am still being geofenced out" while in an allowed
 * territory). The gate used to answer 'blocked' for BOTH a real territory
 * verdict and its own inability to ask — so a missing entry-API URL, a
 * service that is down, or a CORS failure all told the player their region
 * was blocked. That statement was not true, and the fair-play page
 * promises the honest version: "where the service cannot determine your
 * location, entry is not available".
 *
 *   'blocked'     — the service answered, and the answer was no.
 *   'unavailable' — the service could not be asked, or did not answer in a
 *                   shape we understand. Entry stays closed; the player is
 *                   told what actually happened and can retry.
 *
 * Pure logic module (fetch injected) so the gate is unit-tested without a
 * browser; the play client owns the React state around it.
 */

export type GeoGateState = 'checking' | 'allowed' | 'blocked' | 'unavailable';

export async function checkGeoGate(
  entryApiBase: string | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<Exclude<GeoGateState, 'checking'>> {
  // No configured entry API: a deployment fact, never a statement about
  // where the player lives.
  if (!entryApiBase) return 'unavailable';
  try {
    const res = await fetchImpl(`${entryApiBase}/geo`, { method: 'GET' });
    if (!res.ok) return 'unavailable';
    const body = (await res.json()) as { allowed?: unknown };
    if (body.allowed === true) return 'allowed';
    // An explicit false is the service's real verdict; anything else means
    // we did not understand the answer.
    return body.allowed === false ? 'blocked' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}
