/*
 * Opening the provider's funding flow, with an answer (audit 2026-09-11,
 * D-14).
 *
 * Both funding buttons — the wallet card's "Add SOL" and the balance wall's
 * top-up — called the provider directly and caught its throw into
 * `console.error`. The throw that matters is the SDK's "Wallet funding is
 * not enabled", which is its state today whenever funding is switched off
 * in the provider dashboard: the player tapped, no window opened, nothing
 * was said, and on the balance wall that dead button was the only way out
 * offered. A funding call has to return an OUTCOME the surface can render.
 *
 * What it deliberately does NOT do is guess why. The SDK reports a
 * deliberate exit from the funding window and a refusal the same way —
 * telling them apart needs its `onUserExited` callback, which this seam
 * does not have — so both are `unavailable`, and the copy says the window
 * did not open rather than claiming to know which happened.
 *
 * Resolving is not "funds arrived": the provider resolves when the window
 * OPENS, and money can take minutes. Both call sites re-read the balance
 * afterwards and both say so.
 */

import type { AddFundsOptions } from './types';

export type FundingOutcome =
  /** The provider accepted the call — the window is open (or has closed). */
  | 'opened'
  /** No funding seam at all in this build: nothing to call. */
  | 'no-provider'
  /** The provider refused, or the player left. Either way: no window now. */
  | 'unavailable';

export async function openFunding(
  addFunds: ((address: string, options?: AddFundsOptions) => Promise<void>) | undefined,
  wallet: string,
  options: AddFundsOptions
): Promise<FundingOutcome> {
  if (!addFunds) return 'no-provider';
  try {
    await addFunds(wallet, options);
    return 'opened';
  } catch (error) {
    // Logged for an operator — "funding is not enabled" is a dashboard
    // setting somebody has to change — AND returned, so the surface can
    // say something. Logging alone was the defect.
    console.error('funding flow did not open:', error);
    return 'unavailable';
  }
}
