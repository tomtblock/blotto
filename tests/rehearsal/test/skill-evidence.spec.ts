/**
 * Skill-evidence harness specs (D-A2). The full 200-pool study runs nightly
 * in CI and on demand via `npm run skill-evidence`; this suite proves the
 * machinery on a small sample so the per-push run stays fast:
 * determinism, valid populations, conservation, metric arithmetic, and the
 * one ordering that is robust even at a small sample size.
 */
import { expect } from 'chai';
import {
  LADDER,
  generateLadderEntrant,
  homogeneousPopulation,
  ladderPopulation,
  runSkillEvidence,
} from '../src';

describe('the skill-evidence strategy ladder', () => {
  it('every class emits only valid allocations, deterministically', () => {
    for (const cls of LADDER) {
      const a = generateLadderEntrant(cls, 424242);
      const b = generateLadderEntrant(cls, 424242);
      expect(a).to.deep.equal(b, `${cls} must be deterministic per seed`);
      expect(a.battles.length).to.equal(7);
      for (const battle of a.battles) {
        expect(battle.length).to.equal(5);
        expect(battle.reduce((x, y) => x + y, 0)).to.equal(100);
        for (const v of battle) expect(v).to.be.at.least(0);
      }
    }
  });

  it('uniform is exactly the untouched pentagon', () => {
    const e = generateLadderEntrant('uniform', 7);
    for (const battle of e.battles) {
      expect(battle).to.deep.equal([20, 20, 20, 20, 20]);
    }
  });

  it('a study pool holds 16 of each class with class uncorrelated to seat', () => {
    const population = ladderPopulation(9001);
    expect(population.length).to.equal(64);
    const counts = new Map<string, number>();
    for (const e of population) counts.set(e.strategy, (counts.get(e.strategy) ?? 0) + 1);
    for (const cls of LADDER) expect(counts.get(cls)).to.equal(16);
    // Shuffled: the first sixteen seats are not all one class.
    const firstSixteen = new Set(population.slice(0, 16).map((e) => e.strategy));
    expect(firstSixteen.size).to.be.greaterThan(1);
  });
});

describe('the skill-evidence study', () => {
  it('is deterministic, conserves the pot, and separates the ladder ends', async function () {
    this.timeout(120_000);
    const params = { pools: 6, baseSeed: 555000 };
    const a = await runSkillEvidence(params);
    const b = await runSkillEvidence(params);
    expect(a.csv).to.equal(b.csv, 'same parameters must reproduce the CSV byte for byte');
    expect(a.report).to.equal(b.report);

    const byClass = new Map(a.rows.map((r) => [r.cls, r]));
    let total = 0n;
    for (const r of a.rows) {
      expect(r.entrants).to.equal(16 * params.pools);
      expect(r.paidSeats).to.be.at.most(r.entrants);
      expect(r.rankOne).to.be.at.most(r.entrants);
      total += r.paidLamports;
    }
    // Conservation across the whole study: every pool's pot, fully assigned.
    expect(total).to.equal(5_120_000_000n * BigInt(params.pools));

    // The one ordering robust even at a small sample: a three-stat
    // concentrator beats the untouched pentagon (uniform loses its trio
    // stats against every concentrated opponent).
    const uniform = byClass.get('uniform')!;
    const optimised = byClass.get('optimised')!;
    expect(optimised.paidSeats).to.be.greaterThan(uniform.paidSeats);
    expect(optimised.paidLamports > uniform.paidLamports).to.equal(true);

    // CSV never contains a bare 64-integer JSON array (the gitleaks
    // keypair-shape rule) — CSV rows are unbracketed by construction.
    expect(a.csv.includes('[')).to.equal(false);

    // The homogeneous runs (v2 amendment): one row per class, all 64 seats
    // that class, conservation per run, and the mean share pinned at the
    // everyone-equal baseline — the pot divided by the field, exactly.
    expect(a.homogeneous.map((r) => r.cls)).to.deep.equal([
      'random',
      'heuristic',
      'optimised',
    ]);
    for (const r of a.homogeneous) {
      expect(r.entrants).to.equal(64 * params.pools);
      // Everyone in the pool is the class, so the class total IS the pot.
      expect(r.paidLamports).to.equal(5_120_000_000n * BigInt(params.pools));
    }
  });

  it('enforces within-class uniqueness of full allocation sets', () => {
    for (const seed of [555001, 777002]) {
      const mixed = ladderPopulation(seed);
      const byClass = new Map<string, Set<string>>();
      for (const e of mixed) {
        if (e.strategy === 'uniform') continue; // the documented exemption
        const set = byClass.get(e.strategy) ?? new Set<string>();
        const key = JSON.stringify(e.battles);
        expect(set.has(key), `${e.strategy} duplicate in pool ${seed}`).to.equal(false);
        set.add(key);
        byClass.set(e.strategy, set);
      }
      for (const cls of ['random', 'heuristic', 'optimised'] as const) {
        const field = homogeneousPopulation(cls, seed);
        expect(field.length).to.equal(64);
        const keys = new Set(field.map((e) => JSON.stringify(e.battles)));
        expect(keys.size).to.equal(64, `${cls} homogeneous field must be 64 distinct sets`);
      }
    }
    // A homogeneous uniform run is refused by construction.
    expect(() => homogeneousPopulation('uniform', 1)).to.throw(/64-way tie/);
  });
});
