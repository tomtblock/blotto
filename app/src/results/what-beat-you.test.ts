/*
 * What-beat-you specs (v3 D3): the published bundle read back through the
 * production commitment code, and the head-to-head recomputation pinned
 * against hand-computed comparisons.
 *
 * Rewritten in place on 2026-09-16 (the founder's data-minimisation ruling
 * of 2026-09-15): the first cases used to seal a payload with the production
 * sealing code and decrypt it with the revealed secret, the way the view
 * worked when it read the sealed boxes from the read API. The view now reads
 * the published bundle and checks each seat against its committed hash, so
 * that is what these cases exercise.
 */
import { describe, expect, it } from 'vitest';
import { battlesCommitment } from '@blotto/sealing';
import { encodeBattleSet, type BattleSet } from '@blotto/scoring';
import { battlesFromBundle, whatFinishedAbove } from './what-beat-you';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

const flat: BattleSet = Array.from({ length: 7 }, () => [20, 20, 20, 20, 20] as const);
// Beats `flat` in every battle: three stats strictly higher (21 > 20).
const spiky: BattleSet = Array.from({ length: 7 }, () => [21, 21, 21, 17, 20] as const);

/** One published entry, exactly as the bundle carries it: battles and salt
 * as hex, and the hash the chain committed to. */
function published(index: number, battles: BattleSet, saltByte = 7) {
  const salt = new Uint8Array(32).fill(saltByte);
  return {
    player: `P${index}`,
    index,
    battles: hex(encodeBattleSet(battles)),
    salt: hex(salt),
    battles_hash: hex(battlesCommitment(battles, salt)),
    status: 'ok',
  };
}

describe('what finished above you', () => {
  const entries = [published(0, flat), published(1, spiky)];

  it('reads the published battles whose hash recomputes, and skips everything else', () => {
    const tampered = { ...published(2, spiky), battles: hex(encodeBattleSet(flat)) };
    const unrevealed = { ...published(3, flat), battles: null, salt: null };
    const garbage = { ...published(4, flat), battles: 'ab'.repeat(10) };
    const battles = battlesFromBundle({ entries: [...entries, tampered, unrevealed, garbage] });
    expect(battles.size).toBe(2);
    expect(battles.get(0)).toEqual(flat);
    expect(battles.get(1)).toEqual(spiky);
    // A seat whose published battles are not the committed ones is not
    // shown at all — never a guess.
    expect(battles.has(2)).toBe(false);
  });

  it('recomputes the head-to-head for every seat that finished above yours', () => {
    const battles = battlesFromBundle({ entries });
    const standings = [
      { seat: 0, rank: 2, amountLamports: '0' },
      { seat: 1, rank: 1, amountLamports: '4000000000' },
    ];
    const above = whatFinishedAbove(0, standings, battles);
    expect(above.length).toBe(1);
    expect(above[0].seat).toBe(1);
    expect(above[0].rank).toBe(1);
    // spiky takes 3 of 5 stats in every one of the 7 battles.
    expect(above[0].wins).toBe(0);
    expect(above[0].draws).toBe(0);
    expect(above[0].losses).toBe(7);
    // flat takes only the fourth stat (20 > 17); the fifth ties at 20.
    expect(above[0].comparisons[0]).toEqual({ outcome: 'loss', statsA: 1, statsB: 3 });

    // From the winner's seat, nothing is above.
    expect(whatFinishedAbove(1, standings, battles)).toEqual([]);
  });

  /*
   * F-07 (audit 2026-09-11). "Above" was decided by PRIZE AMOUNT over the
   * committed payout list — which holds only the paid seats, and under
   * D-E2 that is one seat. A player who came fourth of sixty-four was
   * shown the winner and told that was what finished above them.
   */
  describe('above is rank, not money (F-07)', () => {
    const field = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        seat: i,
        rank: i + 1,
        // One paid place (D-E2): every other seat is committed zero.
        amountLamports: i === 0 ? '4000000000' : '0',
      }));

    /** Every seat holds a readable battle set, so nothing is dropped for
     * want of ciphertext — the filtering under test is by rank alone. */
    const battlesFor = (n: number) =>
      new Map<number, BattleSet>(
        Array.from({ length: n }, (_, i) => [i, i % 2 === 0 ? flat : spiky])
      );

    it('shows EVERY seat ranked above you, not only the paid one', () => {
      const above = whatFinishedAbove(9, field(16), battlesFor(16));
      // Ranks 1..9 are above rank 10 — nine of them, in rank order.
      expect(above.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      // The old behaviour could only ever return this one.
      expect(above.length).toBeGreaterThan(1);
    });

    it('is ordered best first, by rank', () => {
      const shuffled = [...field(8)].reverse();
      const above = whatFinishedAbove(7, shuffled, battlesFor(8));
      expect(above.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it('does not count a seat you TIED with as above you (D3-B)', () => {
      // Competition ranks: 1, 2, 2, 4 — the other rank 2 is not above.
      const standings = [
        { seat: 0, rank: 1, amountLamports: '4000000000' },
        { seat: 1, rank: 2, amountLamports: '0' },
        { seat: 2, rank: 2, amountLamports: '0' },
        { seat: 3, rank: 4, amountLamports: '0' },
      ];
      const above = whatFinishedAbove(2, standings, battlesFor(4));
      expect(above.map((r) => r.seat)).toEqual([0]);
    });

    it('shows nothing when you are not in the standings, rather than inventing a position', () => {
      expect(whatFinishedAbove(99, field(8), battlesFor(8))).toEqual([]);
    });

    it('skips a seat whose battles could not be decrypted, and keeps the rest', () => {
      const battles = battlesFor(8);
      battles.delete(3);
      const above = whatFinishedAbove(7, field(8), battles);
      expect(above.map((r) => r.seat)).toEqual([0, 1, 2, 4, 5, 6]);
    });
  });
});
