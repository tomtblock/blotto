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

/**
 * How long one tab remembers an `allowed` answer before asking again.
 *
 * The entry page fires this check from an effect on every mount, and every
 * request from an address the service has not seen recently costs it one
 * paid vendor lookup (audit 2026-09-11, B-04). A player who opens the page,
 * looks at a pool, comes back, and opens it again was asking four times for
 * an answer that is a pure function of their address. Shorter than the
 * service's own per-address cache, so the client never holds an answer the
 * service has already let go of.
 *
 * ONLY `allowed` IS REMEMBERED. A `blocked` answer covers a slow or
 * unreachable service too (fail-closed), and the panel's "Check again" must
 * genuinely ask again — so a refusal is never memoised, and `recheck`
 * bypasses the memo outright.
 */
export const GEO_ALLOWED_MEMO_MS = 5 * 60 * 1000;

export type GeoGateState = 'checking' | 'allowed' | 'blocked';

interface Remembered {
  base: string;
  until: number;
}

let remembered: Remembered | null = null;

/** Forget any remembered answer — the tests use it; the app never needs to. */
export function forgetGeoGate(): void {
  remembered = null;
}

export interface GeoGateOptions {
  /** Ask the service even if an `allowed` answer is remembered. */
  recheck?: boolean;
  now?: () => number;
}

export async function checkGeoGate(
  entryApiBase: string | undefined,
  fetchImpl: typeof fetch = fetch,
  options: GeoGateOptions = {}
): Promise<Exclude<GeoGateState, 'checking'>> {
  if (!entryApiBase) return 'blocked';
  const now = options.now ?? Date.now;
  if (
    options.recheck !== true &&
    remembered !== null &&
    remembered.base === entryApiBase &&
    remembered.until > now()
  ) {
    return 'allowed';
  }
  const verdict = await askService(entryApiBase, fetchImpl);
  if (verdict === 'allowed') {
    remembered = { base: entryApiBase, until: now() + GEO_ALLOWED_MEMO_MS };
  }
  return verdict;
}

async function askService(
  entryApiBase: string,
  fetchImpl: typeof fetch
): Promise<Exclude<GeoGateState, 'checking'>> {
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
