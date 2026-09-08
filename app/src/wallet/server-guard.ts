/*
 * Server-only guard.
 *
 * Carried from the predecessor repository, generalised: it lived under a feature
 * directory there and is a cross-cutting primitive, so it sits beside the modules
 * that use it here.
 *
 * The constraint it enforces: server credentials — the Privy app secret, and
 * every secret Phase 1 adds (the entry-packet signer, the settlement signer, the
 * database URL) — are SERVER-SIDE ONLY. A module holding one must never be
 * reachable from a client bundle.
 *
 * Defence in depth, three layers:
 *  1. Secrets are plain (non-`NEXT_PUBLIC_`) env vars, so Next never inlines them
 *     into a client bundle — they read `undefined` client-side regardless.
 *  2. Every server-only module calls `assertServerOnly()` at import time. If such
 *     a module is ever imported into a client bundle it throws the moment it runs in
 *     a browser — a loud failure in dev and build, not a silent leak.
 *  3. Structural: no client component imports these modules.
 *
 * The `typeof window` check is chosen over the `server-only` npm package
 * deliberately: that package throws on import under the plain Node/vitest resolver
 * (no `react-server` condition), which would break these modules' own unit tests.
 * The window check is inert in Node and in server route handlers, and fires only
 * in a browser.
 */

export function assertServerOnly(moduleName: string): void {
  if (typeof window !== "undefined") {
    throw new Error(
      `${moduleName} is server-only and must never run in a client bundle`,
    );
  }
}
