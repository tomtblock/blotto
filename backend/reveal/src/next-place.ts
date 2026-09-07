/**
 * THE NEXT-PLACE DRIVER (audit O23) — the operator side of founder ruling 4.
 *
 * When review upholds a flag, `forfeit_escrow` moves nothing: the share stays
 * in the pool's own vault, marked forfeited, and the ONLY way out is
 * `pay_next_place`, which divides it among the eligible players at the rank
 * it passes to. The program side has been complete and LiteSVM-tested since
 * 2026-09-07. Nothing called it. So the published promise — "an upheld prize
 * is paid to the next eligible player, never to us" — was true on-chain and
 * unreachable in practice, with the money sitting in the vault indefinitely.
 * This module is what reaches it.
 *
 * WHO RECEIVES, in the program's own terms (`escrow.rs::handle_pay_next_place`):
 *
 *   - FIRST PLACE. If any OTHER committed seat is still eligible, the share
 *     is divided among the eligible committed seats — a tie for first where
 *     one member's flag was upheld. Each recipient is proven at its own
 *     committed `(rank 1, amount)` leaf.
 *   - THE NEXT RANK. If no committed seat is eligible (the sole winner
 *     forfeited, or every tied winner did), the whole share passes to the
 *     players at rank `1 + committed.length`, each proven at a leaf carrying
 *     amount 0.
 *
 * In both cases the share is divided EQUALLY and the indivisible remainder
 * goes to the eligible player with the LOWEST entry number. The program
 * recomputes the group from the peers it is handed and refuses arguments that
 * disagree, so this module's job is to compute the same answer the program
 * will, not to be trusted for it.
 *
 * IDEMPOTENT, like everything else in the daemon: it reads the chain's
 * current escrow for the forfeiter each pass and stops when it reaches zero.
 * A portion that already landed is refused by the program (`RankAlreadySettled`)
 * and the next tick simply sees a smaller remaining share.
 *
 * WHAT IT WILL NOT DO: there is no path here that sends a lamport anywhere
 * but to a player. The forfeiter is never a recipient, the operator is never
 * a recipient, and the treasury is not an account this module can name.
 */

import type { ChainEntryView, ChainProofStep, SettlementChain } from './chain';
import { eligibleFor, reviewPending } from './chain';
import type { PublishedRanking } from './ranking';
import { proofForRow } from './ranking';

/** One `pay_next_place` call, fully argued. */
export interface NextPlacePortion {
  /** The forfeiter whose share is being divided (base58). */
  from: string;
  /** The recipient (base58). */
  to: string;
  /** The recipient's committed rank in the published ranking. */
  rank: number;
  /** The recipient's committed amount — 0 at a next-rank leaf. */
  amountLamports: bigint;
  proof: ChainProofStep[];
  /** How many eligible players share the forfeited amount. */
  groupSize: number;
  /** True for the one recipient who takes the indivisible remainder. */
  takesRemainder: boolean;
  /** Every OTHER committed seat's wallet, ascending by seat. */
  peers: string[];
}

/** Why a forfeited share cannot be divided right now. */
export type NextPlaceBlocker =
  | 'no_forfeited_share'
  | 'review_still_pending'
  | 'no_eligible_recipient'
  | 'rank_not_in_ranking';

export interface NextPlacePlan {
  portions: NextPlacePortion[];
  blocker: NextPlaceBlocker | null;
}

/**
 * Work out every `pay_next_place` call for ONE forfeiter. Pure: chain state
 * and the published ranking in, arguments out. The caller executes them.
 */
export function planNextPlace(
  ranking: PublishedRanking,
  entries: readonly ChainEntryView[],
  committedSeats: readonly number[],
  forfeiter: ChainEntryView
): NextPlacePlan {
  const none = (blocker: NextPlaceBlocker): NextPlacePlan => ({ portions: [], blocker });
  if (!forfeiter.forfeited || forfeiter.escrowLamports === 0n) return none('no_forfeited_share');

  const byPlayer = new Map(entries.map((e) => [e.player, e]));
  const bySeat = new Map(entries.map((e) => [e.index, e]));
  const committed = [...committedSeats].sort((a, b) => a - b);

  // The program refuses the whole division while ANY committed seat is still
  // under review — its share is not yet anyone's to receive. Waiting is
  // correct: the review clock or a reviewer will resolve it, and the next
  // tick re-plans. (`NextPlaceReviewPending`.)
  for (const seat of committed) {
    const peer = bySeat.get(seat);
    if (peer && reviewPending(peer, peer.escrowLamports)) return none('review_still_pending');
  }

  // The peers the program recomputes the group from: every committed seat
  // except the forfeiter AND the recipient — so this is per PORTION, not per
  // forfeiter (`escrow.rs` builds `expectedPeers` the same way, and a peers
  // list one entry too long is refused as `NextPlaceIneligible`).
  const peerSeats = committed.filter((s) => s !== forfeiter.index);
  const peersExcluding = (recipientSeat: number): string[] =>
    peerSeats
      .filter((s) => s !== recipientSeat)
      .map((s) => {
        const p = bySeat.get(s);
        if (!p) throw new Error(`committed seat ${s} has no entry`);
        return p.player;
      });

  // Recipients: the eligible committed seats if any, else the next rank.
  const eligibleCommitted = peerSeats
    .map((s) => bySeat.get(s)!)
    .filter((e) => eligibleFor(e, e.escrowLamports));

  let recipients: { player: string; rank: number; amountLamports: bigint; seat: number }[];
  if (eligibleCommitted.length > 0) {
    recipients = eligibleCommitted.map((e) => {
      const row = ranking.rows.find((r) => r.index === e.index);
      if (!row) throw new Error(`committed seat ${e.index} is not in the published ranking`);
      return { player: e.player, rank: row.rank, amountLamports: row.amountLamports, seat: e.index };
    });
  } else {
    const nextRank = 1 + committed.length;
    const atRank = ranking.rows.filter((r) => r.rank === nextRank);
    if (atRank.length === 0) return none('rank_not_in_ranking');
    recipients = atRank
      .filter((r) => {
        const e = byPlayer.get(r.player);
        return e !== undefined && eligibleFor(e, e.escrowLamports);
      })
      .map((r) => ({
        player: r.player,
        rank: r.rank,
        amountLamports: r.amountLamports,
        seat: r.index,
      }));
  }
  if (recipients.length === 0) return none('no_eligible_recipient');

  // Equal split; the indivisible remainder to the LOWEST entry number.
  const groupSize = recipients.length;
  const lowestSeat = Math.min(...recipients.map((r) => r.seat));
  const rowPosition = (player: string): number => {
    const i = ranking.rows.findIndex((r) => r.player === player);
    if (i < 0) throw new Error(`${player} is not in the published ranking`);
    return i;
  };

  return {
    portions: recipients
      .sort((a, b) => a.seat - b.seat)
      .map((r) => ({
        from: forfeiter.player,
        to: r.player,
        rank: r.rank,
        amountLamports: r.amountLamports,
        proof: proofForRow(ranking, rowPosition(r.player)),
        groupSize,
        takesRemainder: r.seat === lowestSeat,
        peers: peersExcluding(r.seat),
      })),
    blocker: null,
  };
}

/** One portion that landed, for the tick report. */
export interface NextPlacePaid {
  poolId: bigint;
  from: string;
  to: string;
}

/**
 * Land every portion of one forfeiter's share. Stops at the first refusal
 * and lets the caller report it — the sweep retries next tick, and a portion
 * the program has already settled is refused rather than double-paid.
 */
export async function payNextPlacePortions(
  chain: Pick<SettlementChain, 'payNextPlace'>,
  poolId: bigint,
  portions: readonly NextPlacePortion[],
  log: (step: string, detail?: Record<string, unknown>) => void = () => {}
): Promise<NextPlacePaid[]> {
  const paid: NextPlacePaid[] = [];
  for (const p of portions) {
    await chain.payNextPlace(
      poolId,
      p.from,
      p.to,
      p.rank,
      p.amountLamports,
      p.proof,
      p.groupSize,
      p.takesRemainder,
      p.peers
    );
    paid.push({ poolId, from: p.from, to: p.to });
    log('pay_next_place', {
      poolId: poolId.toString(),
      from: p.from,
      to: p.to,
      rank: p.rank,
      groupSize: p.groupSize,
      takesRemainder: p.takesRemainder,
    });
  }
  return paid;
}
