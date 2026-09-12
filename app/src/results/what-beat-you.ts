/*
 * "What finished above you" (v3 D3) — pure logic, browser-ready, no wallet.
 *
 * Post-reveal the pool secret is public on-chain, and the read API serves
 * the seat-keyed ciphertexts (only after that reveal — the endpoint fails
 * closed). This module decrypts them with the revealed secret and compares
 * every better-committed seat head-to-head against yours with the SAME
 * engine the crank runs (R20) — the player's machine reaches the numbers
 * itself, trusting nothing.
 *
 * Anonymised by seat: nothing here touches a wallet address, and only the
 * battle sets leave this module — the sealed payload's timings and device
 * hash are decoded and dropped.
 */

import { sealOpen, publicKeyOf, decodePayload } from '@blotto/sealing';
import { compareBattle, type BattleComparison, type BattleSet } from '@blotto/scoring';
import type { SealedEntryRow } from '@/data/types';

const unhex = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/**
 * Decrypt every served ciphertext with the revealed pool secret. A row that
 * fails to open or decode is skipped (the verify page is the full-integrity
 * story; this view renders what opens cleanly).
 */
export function decryptSeatBattles(
  revealedSecretHex: string,
  rows: readonly SealedEntryRow[]
): Map<number, BattleSet> {
  const secretKey = unhex(revealedSecretHex);
  const keypair = { publicKey: publicKeyOf(secretKey), secretKey };
  const out = new Map<number, BattleSet>();
  for (const row of rows) {
    try {
      const opened = sealOpen(unhex(row.ciphertext_hex), keypair);
      if (opened === null) continue;
      out.set(row.seat, decodePayload(opened).battles);
    } catch {
      // Undecodable row — skip; never guess.
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
 * how the ciphertexts are keyed and is NOT committed (the read API says so
 * itself — `LeaderboardRow`), which is fine for a display panel and would
 * not be for anything a player is paid on.
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
