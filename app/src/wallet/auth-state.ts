/*
 * The Auth-snapshot comparator behind the provider's update-loop guard
 * (see the UPDATE-LOOP RULE in auth-provider.tsx — production incident,
 * 2026-08-28). Pure and React-free so the offline unit suite can pin the
 * property that broke production: two snapshots that differ ONLY in
 * callback identity must count as the same state, or the bridge's
 * per-render rebuilds re-enter setState forever (React #185).
 *
 * Every field a consumer can OBSERVE is compared; every function is
 * compared by presence only. Adding a field to `Auth` means adding it here,
 * or its changes are silently swallowed by the guard.
 */

import type { Auth } from "./types";

/** The fields on which two Auth snapshots count as the same state. */
export function sameAuthState(a: Auth, b: Auth): boolean {
  return (
    a.status === b.status &&
    a.unavailable === b.unavailable &&
    a.walletAddress === b.walletAddress &&
    // The optional seams are either wired or absent; their identity is noise.
    (a.addFunds !== undefined) === (b.addFunds !== undefined) &&
    (a.exportWallet !== undefined) === (b.exportWallet !== undefined) &&
    (a.linkWallet !== undefined) === (b.linkWallet !== undefined) &&
    // A failure is the same failure only if it is the same occurrence.
    (a.lastError?.code ?? null) === (b.lastError?.code ?? null) &&
    (a.lastError?.at ?? null) === (b.lastError?.at ?? null) &&
    a.signers.length === b.signers.length &&
    a.signers.every(
      (s, i) =>
        s.address === b.signers[i].address && s.kind === b.signers[i].kind,
    ) &&
    a.detectedWallets.length === b.detectedWallets.length &&
    a.detectedWallets.every((w, i) => w.id === b.detectedWallets[i].id)
  );
}
