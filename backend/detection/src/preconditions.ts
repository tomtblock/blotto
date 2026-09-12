/**
 * What a review decision may do, given where the pool and the entry actually
 * are (audit 2026-09-11, B-25).
 *
 * THE DEFECT. One reviewer key could `flag` or `release` ANY entry in ANY
 * pool with no precondition whatsoever: no state check, no second party, no
 * budget. Authentication was doing the work of authorization — a verified
 * member signature was the whole test, so a single compromised or mistaken
 * key could walk every pool in the system, and the only thing that would
 * refuse it was the program, one instruction at a time, after the fact.
 *
 * WHAT THIS MODULE IS, AND WHAT IT IS NOT. It is the half of B-25 that needs
 * no second person: the action must be legal for this entry, in this pool,
 * right now. The second-reviewer half is a founder decision already ratified
 * in principle (plan §2a; `config/reviewers.json` holds one member today) and
 * the appeal path already demands a different reviewer; a second signer on
 * ordinary flag/clear/release decisions is NOT implemented here and is not
 * this batch's to choose.
 *
 * EVERY RULE BELOW MIRRORS A `require!` THE PROGRAM ALREADY ENFORCES —
 * `programs/blotto_cup/src/instructions/flags.rs` and `escrow.rs`. That is
 * deliberate and it is the safe direction: the program is the authority and
 * refuses anyway, so this layer can only ever refuse EARLIER, never permit
 * something the chain would not. What it buys is a 409 naming the rule
 * instead of a 502 carrying an Anchor error code, an action that is never
 * attempted against an entry it cannot apply to, and — the point of the
 * finding — a precondition that exists at all.
 *
 * Pure functions over two small state reads, so the rules are unit-tested
 * without a cluster.
 */

import type { DecisionAction, ReviewEntryState, ReviewPoolState } from './review';

/**
 * Why an otherwise well-signed decision is refused. Each is a RULE refusal
 * for a verified signer, answered as a 409 — they leak nothing an outsider
 * could not read from the chain, which is public.
 */
export type PreconditionRefusal =
  | 'no_entry'
  | 'pool_state'
  | 'entry_settled'
  | 'flag_unchanged'
  | 'no_escrow'
  | 'already_forfeited'
  | 'sanctions_hold'
  | 'forfeit_requires_flag';

/**
 * Pool states in which each chain-acting decision can do anything at all.
 *
 * flag / clear  A flag only matters before the seat settles (`flags.rs`
 *               rejects a settled entry outright), and a seat settles at
 *               `pay_prizes`. So the pool has to be short of payout:
 *               Open, Sealed or Scored. A Refunding or Closed pool pays no
 *               prize for a flag to hold back, and in a Paid pool every seat
 *               is settled — the entry check below would refuse each one
 *               individually; this refuses the whole class in one read.
 * release /
 * forfeit       Escrow exists only once `pay_prizes` has run, which happens
 *               in Scored and leaves the pool Paid.
 */
const POOL_STATES: Record<'flag' | 'clear' | 'release' | 'forfeit', readonly ReviewPoolState[]> = {
  flag: ['Open', 'Sealed', 'Scored'],
  clear: ['Open', 'Sealed', 'Scored'],
  release: ['Scored', 'Paid'],
  forfeit: ['Scored', 'Paid'],
};

/**
 * May `action` be taken on this entry, in this pool, now? `null` = yes.
 *
 * `entry` is null when the wallet has no entry in the pool at all — the
 * plainest form of the finding: a reviewer key could name any wallet.
 */
export function preconditionRefusal(
  action: DecisionAction,
  pool: ReviewPoolState,
  entry: ReviewEntryState | null
): PreconditionRefusal | null {
  // Appeal rows take no chain action; their rules are the thread's
  // (`appeals.ts`), not the chain's, and are applied by the route.
  if (action === 'appeal_lodged' || action === 'appeal_upheld' || action === 'appeal_dismissed') {
    return null;
  }
  if (!POOL_STATES[action].includes(pool)) return 'pool_state';
  if (entry === null) return 'no_entry';

  switch (action) {
    case 'flag':
      // flags.rs: `require!(!entry.settled)`, `require!(entry.flagged != flagged)`.
      if (entry.settled) return 'entry_settled';
      if (entry.flagged) return 'flag_unchanged';
      return null;
    case 'clear':
      if (entry.settled) return 'entry_settled';
      if (!entry.flagged) return 'flag_unchanged';
      return null;
    case 'release':
      // escrow.rs `handle_release_escrow`: escrow > 0, not forfeited, no
      // sanctions hold. The hold is NOT an integrity flag and is not this
      // seam's to lift — `lift_sanctions_hold` is admin-signed.
      if (entry.escrowLamports <= 0n) return 'no_escrow';
      if (entry.forfeited) return 'already_forfeited';
      if (entry.sanctionsHold) return 'sanctions_hold';
      return null;
    case 'forfeit':
      // escrow.rs `handle_forfeit_escrow`: escrow > 0, flagged, not already
      // forfeited. Forfeiting an unflagged entry would be seizing a share
      // that is merely waiting on KYC — the program says so in as many words.
      if (entry.escrowLamports <= 0n) return 'no_escrow';
      if (entry.forfeited) return 'already_forfeited';
      if (!entry.flagged) return 'forfeit_requires_flag';
      return null;
  }
}
