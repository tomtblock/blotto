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
import type { ResultRow, SealedEntryRow } from '@/data/types';

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
 * The seats committed ABOVE yours (strictly larger amount), best first,
 * each with the head-to-head recomputation against your battles.
 */
export function whatFinishedAbove(
  mySeat: number,
  results: readonly ResultRow[],
  battlesBySeat: ReadonlyMap<number, BattleSet>
): AboveYouRow[] {
  const mine = battlesBySeat.get(mySeat);
  if (!mine) return [];
  const myAmount = BigInt(results.find((r) => r.seat === mySeat)?.amount ?? '0');

  return [...results]
    .filter((r) => r.seat !== mySeat && BigInt(r.amount) > myAmount)
    .sort((a, b) =>
      BigInt(a.amount) > BigInt(b.amount) ? -1 : BigInt(a.amount) < BigInt(b.amount) ? 1 : a.seat - b.seat
    )
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
          amountLamports: r.amount,
          battles: theirs,
          comparisons,
          wins,
          draws,
          losses: comparisons.length - wins - draws,
        },
      ];
    });
}
