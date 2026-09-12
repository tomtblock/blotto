/*
 * What a live run permits the page to do to the screen (audit 2026-09-11,
 * C-17 / D-13).
 *
 * Between "begin" and the seal, seven allocations exist only in the battle
 * flow's own state. Unmounting it destroys them, and the entry page's
 * pre-flight gates — signer present, balance sufficient, no existing entry,
 * pool still open — were re-evaluated on every render, so an ordinary
 * wallet reconnect (the provider re-reporting its accounts, an address
 * arriving a beat late) took the screen away mid-run with no message.
 *
 * The distinction this module draws is the whole fix, and it is the one a
 * reconnect makes hard: an account that BRIEFLY cannot be named is not an
 * account that CHANGED.
 *
 *  - `none`             — no run is on screen; the gates are the pre-flight
 *                         and behave exactly as they always have.
 *  - `transient`        — a run is on screen and nothing about the identity
 *                         behind it has been contradicted: the address is
 *                         the same, or is momentarily unknown. HOLD.
 *  - `account-changed`  — a run is on screen and this browser is signed in,
 *                         with a known address that is NOT the one the run
 *                         began with. An entry is made by one wallet, so
 *                         the run cannot continue — and the page says so
 *                         rather than silently starting again.
 *
 * Pure, so the rule is testable without a DOM.
 */

export type RunInterruption = 'none' | 'transient' | 'account-changed';

export interface RunGuardAuth {
  /** The auth seam's status — only "signed-in" can assert an address. */
  status: string;
  /** The active address, or null while it is unknown. */
  walletAddress: string | null;
}

export function runInterruption(
  /** The address the run began with; null when no run has begun. */
  runWallet: string | null,
  auth: RunGuardAuth
): RunInterruption {
  if (runWallet === null) return 'none';
  // Only a signed-in seam with a NAMED address can contradict the run's
  // identity. "initializing", "signed-out" and a null address are all
  // states an ordinary reconnect passes through.
  if (auth.status === 'signed-in' && auth.walletAddress !== null && auth.walletAddress !== runWallet) {
    return 'account-changed';
  }
  return 'transient';
}
