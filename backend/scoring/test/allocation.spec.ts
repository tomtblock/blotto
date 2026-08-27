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
