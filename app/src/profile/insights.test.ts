import { describe, expect, it } from 'vitest';
import type { CareerRow } from '@/data/types';
import { badgeCounts, bandForAmount, filmRoomForSeat } from './insights';
import type { BattleSet } from '@blotto/scoring';

/* A 5.12 SOL pot (tier 0): multiples of 1024 by construction. */
const POT = '5120000000';
const band = (n: bigint) => ((BigInt(POT) * n) / 1024n).toString();

describe('bandForAmount', () => {
  it('identifies every exact band', () => {
    expect(bandForAmount(band(270n), POT)).toBe(1);
    expect(bandForAmount(band(158n), POT)).toBe(2);
    expect(bandForAmount(band(102n), POT)).toBe(3);
    expect(bandForAmount(band(78n), POT)).toBe(4);
    expect(bandForAmount(band(50n), POT)).toBe(5);
    expect(bandForAmount(band(27n), POT)).toBe(9);
  });

  it('a tie-split amount is shared, never rounded to a rank', () => {
    // Two players splitting 1st+2nd: (270+158)/2 = 214/1024 — no band.
    expect(bandForAmount(band(214n), POT)).toBe('shared');
  });

  it('unpaid and missing-pot rows carry no badge', () => {
    expect(bandForAmount('0', POT)).toBeNull();
    expect(bandForAmount(band(270n), null)).toBeNull();
  });
});

function careerRow(amount: string, paid: boolean): CareerRow {
  return {
    pool: 'P',
    pool_id: '1',
    tier: 0,
    seat: 0,
    entries_to_date: '1',
    paid,
    amount_lamports: amount,
    pot_lamports: POT,
    state: 'Paid',
  };
}

describe('badgeCounts', () => {
  it('counts firsts inside top-3 and everything paid inside paid', () => {
    const counts = badgeCounts([
      careerRow(band(270n), true),
      careerRow(band(102n), true),
      careerRow(band(27n), true),
      careerRow(band(214n), true),
      careerRow('0', false),
    ]);
    expect(counts).toEqual({ first: 1, top3: 2, paid: 4, shared: 1 });
  });
});

describe('filmRoomForSeat', () => {
  const flat: BattleSet = Array.from({ length: 7 }, () => [20, 20, 20, 20, 20]) as BattleSet;
  const spiky: BattleSet = Array.from({ length: 7 }, () => [60, 10, 10, 10, 10]) as BattleSet;

  it('recomputes per-battle outcomes and the field mean, summing to 100', () => {
    const map = new Map<number, BattleSet>([
      [0, spiky],
      [1, flat],
      [2, flat],
    ]);
    const room = filmRoomForSeat(0, map)!;
    expect(room).toHaveLength(7);
    for (const b of room) {
      // 60-10-10-10-10 vs 20-20-20-20-20: loses 4 stats, wins 1 → loss.
      expect(b.losses).toBe(2);
      expect(b.fieldMean.reduce((a, v) => a + v, 0)).toBe(100);
      expect(b.statsAboveMean).toEqual([0]);
    }
  });

  it('returns null when your battles are not decryptable', () => {
    expect(filmRoomForSeat(5, new Map([[0, flat]]))).toBeNull();
  });
});
