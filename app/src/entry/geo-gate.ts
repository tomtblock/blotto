/*
 * The client territory pre-flight (D-B3): ask the entry service's `/geo`
 * verdict BEFORE rendering anything that can take money. FAIL-CLOSED at
 * every edge — no configured entry API, a network failure, a non-200, a
 * malformed body: all of them answer 'blocked'. The pay path renders only
 * on an explicit `{ allowed: true }`.
 *
 * Pure logic module (fetch injected) so the gate is unit-tested without a
 * browser; the play client owns the React state around it.
 */

/** Ceiling on the availability call before the page treats it as failed. */
export const GEO_TIMEOUT_MS = 8_000;

export type GeoGateState = 'checking' | 'allowed' | 'blocked';

export async function checkGeoGate(
  entryApiBase: string | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<Exclude<GeoGateState, 'checking'>> {
  if (!entryApiBase) return 'blocked';
  try {
    // Founder 2026-09-09 ("taking ages to load"): a hung call must not hold
    // the entry page forever — eight seconds, then the fail-closed answer,
    // and the page offers "Check again".
    const res = await fetchImpl(`${entryApiBase}/geo`, {
      method: 'GET',
      signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(GEO_TIMEOUT_MS) : undefined,
    });
    if (!res.ok) return 'blocked';
    const body = (await res.json()) as { allowed?: unknown };
    return body.allowed === true ? 'allowed' : 'blocked';
  } catch {
    return 'blocked';
  }
}
