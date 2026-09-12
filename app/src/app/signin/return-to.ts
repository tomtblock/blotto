/*
 * Where sign-in sends a player afterwards (audit 2026-09-11, D-17).
 *
 * The finding: the sign-in page forwarded to a hard-coded `/play` with no
 * query string. A player who reached it FROM a pool — "Enter" →
 * `/play?pool=<address>` → "Sign in to enter" → sign in — landed on
 * `/play` with no pool, which renders "No pool selected". The tournament
 * they had just chosen was gone, and nothing on the screen said why.
 *
 * The destination therefore travels in the link, as `?next=`. It is
 * attacker-controllable by construction (anyone can put a URL in front of a
 * player), so it is VALIDATED, not trusted: an open redirect on a sign-in
 * page is how a player is walked onto a copy of this site the moment they
 * are in the habit of signing in.
 *
 * What survives validation: a path on THIS site. Nothing else — no scheme,
 * no host, no protocol-relative "//evil.example" (which a browser reads as
 * a host, not a path), no backslash form of the same trick, and no path
 * that is not one we serve.
 */

/** Where a signed-in player goes when the link carried nothing usable. */
export const DEFAULT_SIGNIN_DESTINATION = '/play';

/**
 * The routes sign-in may return to. An allowlist rather than "any path on
 * this origin": the set of places worth returning to is small and known,
 * and a list is the version of this check that cannot be argued into
 * accepting something odd later.
 */
const RETURNABLE = ['/play', '/pools', '/profile', '/wallet', '/verify', '/rules', '/'] as const;

/**
 * Validate a `?next=` value. Returns the path to send the player to, or the
 * default when the value is absent or not something we will redirect to.
 *
 * The query string is PRESERVED for an allowed path — it is the whole point
 * (`/play?pool=<address>`) — and a fragment is dropped, since nothing here
 * uses one and it is one more thing to have to reason about.
 */
export function signInDestination(next: string | null | undefined): string {
  if (!next) return DEFAULT_SIGNIN_DESTINATION;
  const value = next.trim();
  // A path, and only a path. `//host` and `/\host` are both read as hosts
  // by browsers; a scheme ("https:", "javascript:") is not a path at all.
  if (!value.startsWith('/')) return DEFAULT_SIGNIN_DESTINATION;
  if (value.startsWith('//') || value.startsWith('/\\')) return DEFAULT_SIGNIN_DESTINATION;
  // Control characters (including a newline that could split a header) and
  // whitespace have no place in a path we generate ourselves.
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return DEFAULT_SIGNIN_DESTINATION;

  const [pathAndQuery] = value.split('#');
  const [path, query] = splitQuery(pathAndQuery);
  if (!(RETURNABLE as readonly string[]).includes(path)) return DEFAULT_SIGNIN_DESTINATION;
  return query ? `${path}?${query}` : path;
}

function splitQuery(value: string): [string, string | null] {
  const at = value.indexOf('?');
  return at === -1 ? [value, null] : [value.slice(0, at), value.slice(at + 1)];
}

/** Build the link INTO sign-in from a page that wants to be returned to. */
export function signInHref(returnTo: string): string {
  return `/signin?next=${encodeURIComponent(returnTo)}`;
}
