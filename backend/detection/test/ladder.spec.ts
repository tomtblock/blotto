/**
 * Detection under the Ladder (D-E19): pools of 8, 16, 32 and 64 players run
 * at the same time, so two numbers that used to reason from one 64-seat
 * pool are pinned here against the tables themselves.
 *
 *   - The reviewer budget's derivation (`budget.ts`): every paid place of the
 *     eight launch pool types, once, fits inside one window.
 *   - The population-score note (`signals.ts`): over n scores no |z| exceeds
 *     √(n − 1), so the |z| ≥ 3 note is silent on any field under 10.
 */
import { expect } from 'chai';
import { LADDER_TABLES, POOL_CAPACITIES } from '../../scoring/src/prizes';
import { REVIEWER_ACTION_BUDGET, populationScore, type RevealedEntry } from '../src';

/** Both board modes run every size at the launch tier (D-E19, 2026-11-05). */
const LAUNCH_MODES = 2;

describe('the reviewer budget against the Ladder’s launch (D-E13, D-E19)', () => {
  const paidPerMode = POOL_CAPACITIES.reduce((a, cap) => a + LADDER_TABLES[cap].length, 0);
  const seatsPerMode = POOL_CAPACITIES.reduce((a, cap) => a + cap, 0);

  it('the arithmetic the derivation states', () => {
    expect(paidPerMode, 'paid places across the four sizes').to.equal(30);
    expect(LAUNCH_MODES * paidPerMode).to.equal(60);
    expect(LAUNCH_MODES * seatsPerMode).to.equal(240);
  });

  it('covers one decision on every paid place of the eight launch pools in one window', () => {
    expect(REVIEWER_ACTION_BUDGET).to.be.at.least(LAUNCH_MODES * paidPerMode);
  });

  it('does NOT cover a flag and a decision on each of them in the same window — stated, not hidden', () => {
    // The derivation says so in as many words; if the budget is ever raised
    // past this, that comment is out of date and this case says which line.
    expect(REVIEWER_ACTION_BUDGET).to.be.below(2 * LAUNCH_MODES * paidPerMode);
  });
});

describe('the population-score note on small fields (D-E19)', () => {
  /** One outlier and n − 1 identical scores: the largest |z| n scores allow. */
  function field(n: number): RevealedEntry[] {
    return Array.from({ length: n }, (_, i) => ({
      player: `P${i}`,
      index: i,
      battles: [],
      timingsMs: [],
      deviceHash: `d${i}`,
      scoreHalf: i === 0 ? 14 : 0,
    }));
  }

  it('cannot fire on a field under 10, however far one score stands out', () => {
    // 5 is an 8-player pool's minimum field; 8 a full one; 9 the most a
    // 16-player pool can hold below its own minimum field of 10.
    for (const n of [5, 8, 9]) {
      expect(populationScore(field(n)), `${n} seated`).to.deep.equal([]);
    }
  });

  it('fires once the field is large enough for |z| to reach 3', () => {
    // √(11 − 1) ≈ 3.16: the lone outlier is noted, nobody else.
    const findings = populationScore(field(11));
    expect(findings.map((f) => f.player)).to.deep.equal(['P0']);
    expect(findings[0].severity).to.equal('note');
  });
});
