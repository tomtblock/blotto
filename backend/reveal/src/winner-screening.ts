/**
 * THE WINNER CHECK (Phase 2, Stage F) — the last of the four published
 * promises to become operational.
 *
 * The rules page says, of resolving: "we check the winning wallet against
 * published sanctions lists, as we are required to." Screening has run at
 * ENTRY since Stage B. This is the other end: the crank screens the wallets
 * it is about to pay, in the same pass that scored the pool, and places an
 * on-chain `sanctions_hold` on any it must not pay yet.
 *
 * # Who is screened
 *
 * Every wallet in the committed payout list — not "the winner" singular.
 * Under D-E2 that is normally one seat, but a tie for first divides the pot
 * between several, and each of them is a winning wallet in the only sense
 * the promise can mean. At most a handful of screenings per pool.
 *
 * # What a hold does, and what it is not
 *
 * A hold placed here makes `pay_prizes` ESCROW the share instead of sending
 * it, and both paths of `release_escrow` — including the seven-day
 * permissionless one — then refuse to let it out. The pool still reaches
 * `Paid`: one wallet's share is held, everyone else is paid, and the tier is
 * freed. It is emphatically NOT `flag_entry`: list membership is not a
 * finding about play, carries no reviewer and no criterion, and must never
 * pay the money to other players.
 *
 * # A screening that cannot answer
 *
 * It HOLDS, and says why. The seam's rule for this call site is "hold one
 * payment for a human and never strand the pool", and a hold is exactly
 * that: the pool settles, the one share waits for an admin. The alternative
 * — paying a wallet nobody could screen — is the one outcome the promise
 * forbids, and stalling the pool is the outcome the daemon forbids.
 *
 * The distinction survives into the log, because it matters: `listed` means
 * a published list named the address, and `screening_unavailable` means we
 * could not check. Only the first is a sanctions match. Neither is published
 * as an integrity finding.
 */

import { isListed, type SanctionsCheck, type SanctionsMatch } from '../../sanctions/src';

/** Why a winning wallet is held. */
export type WinnerHoldReason = 'listed' | 'screening_unavailable';

/** One wallet the crank must hold before it pays. */
export interface WinnerHold {
  /** The wallet, base58. */
  player: string;
  reason: WinnerHoldReason;
  /**
   * The listings that matched, for the operator's record — empty when the
   * reason is `screening_unavailable`. Carries no score: a `SanctionsMatch`
   * has no field that could hold one (`seam.ts`).
   */
  matches: readonly SanctionsMatch[];
  /** The screener's error text when it could not answer. */
  error?: string;
}

/**
 * The crank's hook: the wallets about to be paid in, the ones to hold out.
 * A local type so `crank.ts` needs no cross-package import and a test can
 * drive it with a plain function.
 */
export type ScreenWinners = (
  poolId: bigint,
  wallets: readonly string[]
) => Promise<WinnerHold[]>;

/**
 * Build the hook from a screener. Screens sequentially: the list is a
 * handful of wallets at most, and one vendor request at a time keeps a rate
 * limit from turning a tie into a burst of failures that would hold every
 * winner at once.
 */
export function makeWinnerScreen(
  check: SanctionsCheck,
  log: (step: string, detail?: Record<string, unknown>) => void = () => {}
): ScreenWinners {
  return async (poolId, wallets) => {
    const holds: WinnerHold[] = [];
    for (const player of wallets) {
      try {
        const verdict = await check.screen(player);
        if (isListed(verdict)) {
          holds.push({ player, reason: 'listed', matches: verdict.matches });
          log('winner-screen:listed', {
            poolId: poolId.toString(),
            player,
            lists: verdict.matches.map((m) => `${m.source}/${m.listName}`),
          });
        } else {
          log('winner-screen:clear', {
            poolId: poolId.toString(),
            player,
            consulted: verdict.consulted,
            failed: verdict.failed,
          });
        }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        holds.push({ player, reason: 'screening_unavailable', matches: [], error });
        log('winner-screen:unavailable', { poolId: poolId.toString(), player, error });
      }
    }
    return holds;
  };
}
