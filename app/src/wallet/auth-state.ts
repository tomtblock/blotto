/*
 * The Auth-snapshot comparator behind the provider's update-loop guard
 * (see the UPDATE-LOOP RULE in auth-provider.tsx — production incident,
 * 2026-08-28). Pure and React-free so the offline unit suite can pin the
 * property that broke production: two snapshots that differ ONLY in
 * callback identity must count as the same state, or the bridge's
 * per-render rebuilds re-enter setState forever (React #185).
 */

import type { Auth } from "./types";

/** The fields on which two Auth snapshots count as the same state. */
export function sameAuthState(a: Auth, b: Auth): boolean {
  return (
    a.status === b.status &&
    a.walletAddress === b.walletAddress &&
    // A sign-in failure is a state change screens must see (it is a value,
    // not a callback, so comparing it cannot reintroduce the loop).
    (a.lastAuthError ?? null) === (b.lastAuthError ?? null) &&
    // The funding seam is either wired or absent; its identity is noise.
    (a.addFunds !== undefined) === (b.addFunds !== undefined) &&
    a.signers.length === b.signers.length &&
    a.signers.every(
      (s, i) =>
        s.address === b.signers[i].address && s.kind === b.signers[i].kind,
    )
  );
}
