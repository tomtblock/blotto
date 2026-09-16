/*
 * "What finished above you" (v3 D3) — pure logic, browser-ready, no wallet.
 *
 * Post-reveal the pool's battle set is PUBLISHED: the bundle at the archive's
 * permanent URI carries every seat's battles and salt beside the hash the
 * chain committed to. This module reads that bundle, recomputes each seat's
 * commitment (`sha256(battles ‖ salt)`, the sealing package's one
 * definition) and keeps only the seats whose published battles match what
 * was committed — then compares every better-ranked seat head-to-head
 * against yours with the SAME engine the crank runs (R20). The player's
 * machine reaches the numbers itself, trusting nothing.
 *
 * WHAT CHANGED 2026-09-16 (the founder's data-minimisation ruling of
 * 2026-09-15). Until then this module opened the sealed boxes, fetched from
 * the read API's `sealed-entries` route, with the revealed secret. The box
 * carries two things the published bundle deliberately does not (bundle
 * version 2, audit B-31): the seven per-screen timings and the device
 * marker. Decoding them here "and dropping them" did not make them private;
 * serving the boxes did the opposite. The route is gone, the boxes have no
 * public reader, and the bundle — which is what verification recomputes from
 * anyway — is the only source this view reads.
 *
 * Anonymised by seat: nothing here touches a wallet address, and only the
 * battle sets leave this module.
 */

import { battlesCommitment } from '@blotto/sealing';
import { compareBattle, decodeBattleSet, type BattleComparison, type BattleSet } from '@blotto/scoring';
import type { PublishedBundle } from '@/verify/logic';

const unhex = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};
const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Every seat's battles from the published bundle, keyed by seat — but ONLY a
 * seat whose published battles and salt recompute to its committed hash. A
 * seat with no published plaintext (a missing reveal), an undecodable set,
 * or a hash that does not match is skipped, never guessed: the verify page is
 * the full-integrity story, and this view renders what checks out.
 */
export function battlesFromBundle(bundle: Pick<PublishedBundle, 'entries'>): Map<number, BattleSet> {
  const out = new Map<number, BattleSet>();
  for (const entry of bundle.entries) {
    if (entry.battles === null || entry.salt === null) continue;
    try {
      const battles = decodeBattleSet(unhex(entry.battles));
      const committed = entry.battles_hash.toLowerCase();
      if (hex(battlesCommitment(battles, unhex(entry.salt))) !== committed) continue;
      out.set(entry.index, battles);
    } catch {
      // Undecodable entry — skip; never guess.
    }
  }
  return out;
}

export interface AboveYouRow {
  seat: number;
  /** Their competition rank (D3-B: tied players share one). */
  rank: number;
  /** Committed amount for that seat, lamports as decimal string. */
  amountLamports: string;
  /** Their seven allocations. */
  battles: BattleSet;
  /** The seven comparisons, from YOUR perspective. */
  comparisons: BattleComparison[];
  /** Head-to-head tallies from your perspective. */
  wins: number;
  draws: number;
  losses: number;
}

/**
 * One seat's standing, as the panel must be given it (audit 2026-09-11,
 * F-07). `rank` is the committed field of the results-root leaf; `seat` is
 * how the bundle's entries are indexed and is NOT committed (the read API
 * says so itself — `LeaderboardRow`), which is fine for a display panel and
 * would not be for anything a player is paid on.
 */
export interface StandingRow {
  seat: number;
  rank: number;
  amountLamports: string;
}

/**
 * The seats that finished ABOVE yours — by RANK, best first — each with the
 * head-to-head recomputation against your battles.
 *
 * WHY RANK AND NOT MONEY (F-07). This used to take the committed payout
 * list and call "above" any seat with a strictly larger amount. Two things
 * were wrong with that, and they compound:
 *
 *  - the payout list contains ONLY THE PAID SEATS, so every unpaid player
 *    who nonetheless finished ahead of you was invisible;
 *  - under D-E2 one place is paid, so "a strictly larger amount" can only
 *    ever be the winner. A player who came 4th of 64 was shown exactly one
 *    opponent and told that was what finished above them.
 *
 * Rank is the ordering the competition is decided by; money is a
 * consequence of it, and under a one-paid-place band it is a constant.
 *
 * Ties (D3-B) share a rank, and a player is not "above" someone they tied
 * with: the test is strictly smaller rank.
 */
export function whatFinishedAbove(
  mySeat: number,
  standings: readonly StandingRow[],
  battlesBySeat: ReadonlyMap<number, BattleSet>
): AboveYouRow[] {
  const mine = battlesBySeat.get(mySeat);
  if (!mine) return [];
  const myRank = standings.find((r) => r.seat === mySeat)?.rank;
  // Not in the standings: nothing to be above. Said explicitly rather than
  // defaulting to a rank, which would invent a position for this player.
  if (myRank === undefined) return [];

  return [...standings]
    .filter((r) => r.seat !== mySeat && r.rank < myRank)
    .sort((a, b) => a.rank - b.rank || a.seat - b.seat)
    .flatMap((r) => {
      const theirs = battlesBySeat.get(r.seat);
      if (!theirs) return [];
      // From MY perspective: compareBattle(mine, theirs).
      const comparisons = mine.map((allocation, k) => compareBattle(allocation, theirs[k]));
      const wins = comparisons.filter((c) => c.outcome === 'win').length;
      const draws = comparisons.filter((c) => c.outcome === 'draw').length;
      return [
        {
          seat: r.seat,
          rank: r.rank,
          amountLamports: r.amountLamports,
          battles: theirs,
          comparisons,
          wins,
          draws,
          losses: comparisons.length - wins - draws,
        },
      ];
    });
}
