/*
 * The pre-launch code gate: shared constants and the pure decisions.
 *
 * The gate exists so blotto.gg can be shown to named people before launch while
 * the Vercel alias (blotto-jade.vercel.app) stays open to us. It is a DOOR ON
 * THE UI, not a security boundary: blotto-packet and blotto-indexer are
 * reachable by anyone who knows their hostnames, and the real access controls
 * (territory schedule, packet issuance, clickwrap) are unchanged by anything here.
 *
 * Vercel's own Password Protection cannot do this job: it is a property of the
 * DEPLOYMENT, not of the domain, so switching it on would lock the .vercel.app
 * URL we are deliberately keeping open.
 *
 * Which hosts are gated is env-driven (GATE_HOSTS) rather than hardcoded, so a
 * local run can exercise the real path without editing code — the same rule the
 * RPC module follows for its endpoint.
 */

/** The hosts gated when GATE_HOSTS is unset. Production's intended posture. */
export const DEFAULT_GATED_HOSTS = ['blotto.gg', 'www.blotto.gg'] as const;

/** The admission cookie. Holds GATE_COOKIE_SECRET, never GATE_CODE. */
export const GATE_COOKIE = 'blotto_gate';

/** Thirty days. Long enough that a reviewer types the code once. */
export const GATE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/** Parse GATE_HOSTS ("a.example, b.example") into a lowercase set. */
export function gatedHosts(raw: string | undefined): Set<string> {
  const listed = (raw ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
  return new Set(listed.length > 0 ? listed : DEFAULT_GATED_HOSTS);
}

/** The requested hostname, port and case stripped. */
export function normalizeHost(raw: string | null | undefined): string {
  return (raw ?? '').toLowerCase().split(':')[0].trim();
}

/**
 * The post-admission destination, or "/".
 *
 * Rejects anything that is not a same-site absolute path — a `next` of
 * "//evil.example" or "https://evil.example" would otherwise turn the gate into
 * an open redirect, which is a phishing primitive we are not shipping.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

/**
 * Constant-time string comparison.
 *
 * A plain `===` returns as soon as two bytes differ, which leaks the length of
 * the correct prefix to anyone willing to measure. Cheap to avoid.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}
