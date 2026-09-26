/*
 * Validating the wallet a reviewer is about to FLAG.
 *
 * Every other control on the review page acts on a row that is already in
 * the table, so the wallet is never in doubt. Flagging is the one decision
 * that has to NAME a wallet the page is not yet showing — the table lists
 * only entries that are already flagged or already escrow-settled — so it is
 * the one decision that can be aimed at the wrong thing.
 *
 * Pure, and in its own module, because this page keeps its logic out of the
 * JSX and its tests on the logic (`decision-outcome.ts`, `complaints-desk.ts`
 * and `detection-request.ts` are all done this way).
 *
 * WHAT A FLAG DOES, since it is the reason this care is warranted: a flagged
 * entry's prize share is ESCROWED at `pay_prizes` instead of being paid
 * (`programs/blotto_cup/src/instructions/pay_prizes.rs`). It moves no money
 * by itself and it takes nothing away — the share sits in the pool's vault
 * until a reviewer releases it or an admin-signed forfeit passes it to the
 * next eligible place. But it does withhold a real payment from a real
 * player, and the program refuses a flag once the entry has settled, so the
 * window to place one closes the moment the pool pays.
 *
 * The server checks all of this again and is the authority (`preconditions.ts`
 * mirrors the program's own `require!` lines, and can only ever refuse
 * earlier than the chain would). These checks exist to spend the reviewer's
 * signature well, not to be trusted.
 */

/**
 * Base58, 32-44 characters — a Solana address.
 *
 * NOTE: the same expression is written out in `api/detection/route.ts`,
 * `api/complaints/route.ts` and `data/scenarios.test.ts`. Four copies is one
 * too many and they should share an export; that is a change across four
 * files and is deliberately not made here.
 */
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type FlagTargetRefusal = 'empty' | 'malformed' | 'already_flagged';

/**
 * Why this wallet cannot be flagged, or `null` when it can.
 *
 * `alreadyFlagged` is the player column of the rows the page is showing —
 * every entry in this pool that already carries a flag or has already
 * settled its escrow. The server would answer `flag_unchanged` for one of
 * those; saying so here saves the reviewer a signature and a round trip.
 */
export function flagTargetRefusal(
  target: string,
  alreadyFlagged: readonly string[]
): FlagTargetRefusal | null {
  const wallet = target.trim();
  if (!wallet) return 'empty';
  if (!BASE58_ADDRESS.test(wallet)) return 'malformed';
  if (alreadyFlagged.includes(wallet)) return 'already_flagged';
  return null;
}

/** The sentence the reviewer reads. Kept beside the rule that produces it. */
export function flagTargetMessage(refusal: FlagTargetRefusal): string {
  switch (refusal) {
    case 'empty':
      return 'name the wallet to flag';
    case 'malformed':
      return 'that is not a wallet address — expected 32 to 44 base58 characters';
    case 'already_flagged':
      return 'that wallet is already flagged in this pool — its row is in the table below';
  }
}
