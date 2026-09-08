/**
 * Scoring with missing entries — the published lost-ciphertext rule
 * (TECH-ARCH §5): a lost ciphertext means that entry is scored as all
 * losses and its entry price is refunded from the platform treasury (an
 * off-chain payment). TECH-ARCH §5 still words that refund as coming
 * "from the platform share"; that phrasing predates D-A1 (revised) —
 * `register` credits 100% of an entry to the treasury, the pot is a fixed
 * constant funded from the treasury at `open_pool`, and the 80/20 split is
 * gone (state.rs PLATFORM_SEED, prize_math.rs, and the TECH-ARCH divergence
 * list in docs/INDEX.md).
 *
 * Made precise here, because "all losses" needs a definition players can
 * recompute (tradeoff order #3):
 *
 *   - a missing entry LOSES every battle against every present entry:
 *     each present player gains a full win (2 half-points) per battle,
 *     and gains no zones (there are no stats to compare);
 *   - two missing entries DRAW every battle against each other (1 half-point
 *     each) — neither produced a set that beats the other;
 *   - missing entries score 0 zones; equal on (score, zones) by construction,
 *     they are TIED under D3-B and share one competition rank (they'd split
 *     any prize their positions carry, like any other tie group).
 *
 * Uniform by construction: every present player faces the same missing
 * opponents, so the adjustment shifts everyone's score equally and the
 * relative ranking among present players is EXACTLY `scorePool`'s.
 */

import { BATTLES, scorePool, type BattleSet, type PlayerResult } from './deps';

export interface PoolEntryInput {
  /** Seat index, 0-based. */
  index: number;
  /** The decrypted, verified battle set — or null when lost/failed. */
  battles: BattleSet | null;
}

/** Score a pool where some entries may be missing. Results in seat order. */
export function scoreWithMissing(entries: readonly PoolEntryInput[]): PlayerResult[] {
  const sorted = [...entries].sort((a, b) => a.index - b.index);
  sorted.forEach((e, i) => {
    if (e.index !== i) throw new Error(`seat indices must be 0..n-1 without gaps (saw ${e.index} at ${i})`);
  });
  const present = sorted.filter((e) => e.battles !== null);
  const missing = sorted.filter((e) => e.battles === null);

  // Score present players among themselves with the pure engine.
  const presentResults = scorePool(present.map((e) => e.battles as BattleSet));

  const score = new Map<number, { scoreHalf: number; zones: number }>();
  present.forEach((e, i) => {
    score.set(e.index, {
      // + a full win per battle per missing opponent.
      scoreHalf: presentResults[i].scoreHalf + missing.length * BATTLES * 2,
      zones: presentResults[i].zones,
    });
  });
  for (const e of missing) {
    score.set(e.index, {
      // Draws against the other missing entries only.
      scoreHalf: (missing.length - 1) * BATTLES,
      zones: 0,
    });
  }

  const order = sorted
    .map((e) => e.index)
    .sort((i, j) => {
      const a = score.get(i)!;
      const b = score.get(j)!;
      return b.scoreHalf - a.scoreHalf || b.zones - a.zones || i - j;
    });
  // Competition ranks (D3-B): equal (score, zones) shares a rank.
  const rank = new Map<number, number>();
  let groupStartPos = 0;
  order.forEach((i, pos) => {
    if (pos > 0) {
      const a = score.get(i)!;
      const b = score.get(order[pos - 1])!;
      if (a.scoreHalf !== b.scoreHalf || a.zones !== b.zones) groupStartPos = pos;
    }
    rank.set(i, groupStartPos + 1);
  });
  return sorted.map((e) => ({
    index: e.index,
    scoreHalf: score.get(e.index)!.scoreHalf,
    zones: score.get(e.index)!.zones,
    rank: rank.get(e.index)!,
    amountLamports: 0n,
  }));
}
