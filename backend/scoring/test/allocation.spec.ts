/** Allocation invariant + encoding unit specs (PID §4.6). */
import { expect } from 'chai';
import { assertAllocation, decodeBattleSet, encodeBattleSet } from '../src';

describe('the allocation invariant', () => {
  it('accepts five integers summing to 100', () => {
    expect(() => assertAllocation([20, 20, 20, 20, 20])).to.not.throw();
    expect(() => assertAllocation([100, 0, 0, 0, 0])).to.not.throw();
  });
  it('rejects wrong count, wrong sum, negatives, floats', () => {
    expect(() => assertAllocation([25, 25, 25, 25])).to.throw('exactly 5');
    expect(() => assertAllocation([20, 20, 20, 20, 21])).to.throw('sum to exactly 100');
    expect(() => assertAllocation([-1, 21, 20, 20, 40])).to.throw('integers in [0, 100]');
    expect(() => assertAllocation([20.5, 19.5, 20, 20, 20])).to.throw('integers in [0, 100]');
  });
  it('round-trips the 35-byte encoding', () => {
    const battles = Array.from({ length: 7 }, (_, k) => {
      const a = [20, 20, 20, 20, 20];
      a[k % 5] += 5;
      a[(k + 1) % 5] -= 5;
      return a;
    });
    const bytes = encodeBattleSet(battles as never);
    expect(bytes.length).to.equal(35);
    expect(decodeBattleSet(bytes)).to.deep.equal(battles);
  });
  it('rejects decoding bytes that violate the invariant', () => {
    const bytes = new Uint8Array(35).fill(20); // each battle sums to 100 ✓
    bytes[0] = 21; // now battle 0 sums to 101
    expect(() => decodeBattleSet(bytes)).to.throw('sum to exactly 100');
  });
});

/**
 * The HARD placing rule (Phase B, founder rulings 2026-09-24): the board's
 * thirty-five stats sum to exactly 700, no per-battle rule, two bytes per
 * stat on the wire. Every function defaults to easy, so the specs above are
 * unchanged; these pin the hard branch of each.
 */
describe('the hard placing rule (Phase B)', () => {
  const { assertBattleSet, battlesHash, HARD_TOTAL, HARD_BATTLE_SET_BYTES, boardModeOf, boardModeByte } =
    require('../src');
  const stacked = [[700, 0, 0, 0, 0], ...Array.from({ length: 6 }, () => [0, 0, 0, 0, 0])];
  const spread = Array.from({ length: 7 }, () => [20, 20, 20, 20, 20]);

  it('accepts a whole board in one battle, and an even spread', () => {
    expect(() => assertBattleSet(stacked, 'hard')).to.not.throw();
    expect(() => assertBattleSet(spread, 'hard')).to.not.throw();
    expect(HARD_TOTAL).to.equal(700);
  });
  it('rejects a board one point off 700, a stat above 700, and a stacked board under the EASY rule', () => {
    const short = spread.map((b) => [...b]);
    short[6][4] = 19;
    expect(() => assertBattleSet(short, 'hard')).to.throw('sum to exactly 700');
    expect(() => assertAllocation([701, 0, 0, 0, 0], 'hard')).to.throw('integers in [0, 700]');
    expect(() => assertBattleSet(stacked)).to.throw(/sum to exactly 100|integers in \[0, 100\]/);
  });
  it('round-trips the 70-byte encoding, little-endian per stat', () => {
    const bytes = encodeBattleSet(stacked as never, 'hard');
    expect(bytes.length).to.equal(HARD_BATTLE_SET_BYTES);
    expect(bytes[0]).to.equal(700 & 0xff);
    expect(bytes[1]).to.equal(700 >> 8);
    expect(decodeBattleSet(bytes, 'hard')).to.deep.equal(stacked);
  });
  it('refuses the other mode’s length either way', () => {
    expect(() => decodeBattleSet(new Uint8Array(70), 'easy')).to.throw('35 bytes');
    expect(() => decodeBattleSet(new Uint8Array(35), 'hard')).to.throw('70 bytes');
  });
  it('commits differently to the same numbers under the two modes', () => {
    const salt = new Uint8Array(32).fill(3);
    const easy = Buffer.from(battlesHash(spread as never, salt)).toString('hex');
    const hard = Buffer.from(battlesHash(spread as never, salt, 'hard')).toString('hex');
    expect(easy).to.not.equal(hard);
  });
  it('maps the wire byte both ways and refuses an unknown one', () => {
    expect(boardModeOf(0)).to.equal('easy');
    expect(boardModeOf(1)).to.equal('hard');
    expect(boardModeOf(null)).to.equal('easy', 'a pre-Phase-B event or account played easy');
    expect(boardModeOf(undefined)).to.equal('easy');
    expect(() => boardModeOf(2)).to.throw('unknown board mode');
    expect(boardModeByte('easy')).to.equal(0);
    expect(boardModeByte('hard')).to.equal(1);
  });
});
