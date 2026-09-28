/*
 * The build check (2026-09-28, D-E18): every player seals against the
 * build the server is serving.
 *
 * WHY. There is one app on every channel — the site, and the Android shell
 * that opens the site — so a deploy reaches all of them at once. What a
 * deploy cannot reach is a page ALREADY OPEN: a browser tab, or far more
 * often a phone app left in the background for days. The entry is built on
 * the player's device (entry/submit.ts encodes the board into a fixed
 * layout the scoring engine decodes), so a page from an older build could
 * seal an entry the current engine reads as malformed, and a malformed
 * entry scores as all losses. The pool stays fair; that player loses the
 * entry. Two players in one pool must be on one build.
 *
 * HOW. next.config.ts stamps NEXT_PUBLIC_BUILD_VERSION into the bundle AND
 * into the server route that answers it (/api/version), from the same
 * string, so within one build the two agree by construction. Just before
 * the seal — and once when the play page opens, so the common case is
 * caught before a board is played — the page asks the route and compares.
 *
 *   same     → seal.
 *   stale    → stop before anything is signed; offer a reload.
 *   unknown  → seal. The route did not answer (a timeout, a network blip,
 *              a gated host refusing the fetch). This check guards against
 *              a STALE page, not an absent server; failing closed here
 *              would turn every transient fault on the way to /api/version
 *              into a refused entry, on a path that already has a
 *              fail-closed territory gate in front of it. A stale page
 *              whose version fetch also failed is the one case that slips
 *              through, and it is caught by the scoring engine's malformed-
 *              set status as it is today.
 *
 * Pure over an injected fetch, so the verdicts are unit-tested with no
 * network.
 */

/** The stamp of THIS bundle, inlined at build (next.config.ts). */
export const BUILD_VERSION: string = process.env.NEXT_PUBLIC_BUILD_VERSION ?? 'unversioned';

/** The route the server answers from the same stamp. */
export const VERSION_ROUTE = '/api/version';

/** Ceiling on the version fetch: past this the verdict is `unknown`. */
export const VERSION_CHECK_TIMEOUT_MS = 4_000;

export type VersionVerdict = 'same' | 'stale' | 'unknown';

/**
 * Compare this bundle's stamp with what the server said. `served` is the
 * parsed body of the route's answer, untrusted: anything but an object with
 * a non-empty string `version` is `unknown`.
 */
export function versionVerdict(current: string, served: unknown): VersionVerdict {
  if (typeof served !== 'object' || served === null) return 'unknown';
  if (!Object.prototype.hasOwnProperty.call(served, 'version')) return 'unknown';
  const version = (served as { version?: unknown }).version;
  if (typeof version !== 'string' || version === '') return 'unknown';
  return version === current ? 'same' : 'stale';
}

export interface VersionCheckDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** This bundle's stamp; BUILD_VERSION in the app, a literal in tests. */
  current: string;
  timeoutMs?: number;
}

/** Ask the server which build is live and compare. Never throws. */
export async function checkBuildVersion(deps: VersionCheckDeps): Promise<VersionVerdict> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? VERSION_CHECK_TIMEOUT_MS);
  try {
    const res = await deps.fetch(VERSION_ROUTE, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) return 'unknown';
    return versionVerdict(deps.current, await res.json());
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}
