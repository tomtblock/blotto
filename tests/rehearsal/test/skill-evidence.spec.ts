/**
 * Skill-evidence harness specs (D-A2). The full 200-pool study runs nightly
 * in CI and on demand via `npm run skill-evidence`; this suite proves the
 * machinery on a small sample so the per-push run stays fast:
 * determinism, valid populations, conservation, metric arithmetic, and the
 * one ordering that is robust even at a small sample size.
 */
import { expect } from 'chai';
import {
  LADDER_TABLES,
  MIN_FIELD_BY_CAPACITY,
  POOL_CAPACITIES,
} from '../../../backend/scoring/src';
import {
  CSV_COLUMNS,
  LADDER,
  STUDY_FIELDS,
  classCounts,
  generateLadderEntrant,
  homogeneousPopulation,
  ladderPopulation,
  offlinePoolTerms,
  runSkillEvidence,
  type FieldResult,
} from '../src';
import { csvToJson } from '../src/skill-evidence-json';

// The study settles tier-0 pools; conservation is asserted against each
// pool size's prize pool as the pool is opened with it (D-E19). The tables
// themselves are pinned in constants.rs and backend/scoring — this suite
// checks the money adds up, not what the numbers are.
const prizePoolOf = (f: FieldResult) => offlinePoolTerms(f.capacity).potLamports;

/** Every field's money, checked: each run pays exactly `pools` prize pools. */
function expectConserved(fields: FieldResult[], pools: number) {
  for (const f of fields) {
    const label = `${f.seats} of ${f.capacity}`;
    expect(f.prizePoolLamports, label).to.equal(prizePoolOf(f));
    let mixed = 0n;
    let entrants = 0;
    let paid = 0;
    for (const r of f.rows) {
      expect(r.paidEntries, label).to.be.at.most(r.entrants);
      expect(r.rankOne, label).to.be.at.most(r.entrants);
      mixed += r.paidLamports;
      entrants += r.entrants;
      paid += r.paidEntries;
    }
    expect(mixed, `${label} mixed conservation`).to.equal(f.prizePoolLamports * BigInt(pools));
    expect(entrants, `${label} seats filled`).to.equal(f.seats * pools);
    // Ties can only widen the paid set past the table, never narrow it.
    expect(paid, `${label} paid places`).to.be.at.least(f.table.length * pools);
    for (const r of f.homogeneous) {
      expect(r.entrants).to.equal(f.seats * pools);
      // Everyone in the pool is the class, so the class total IS the prize pool.
      expect(r.paidLamports, `${label} ${r.cls} homogeneous`).to.equal(
        f.prizePoolLamports * BigInt(pools)
      );
    }
  }
}

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

  it('the hard ladder emits only valid 700-point boards, deterministically (Phase B)', () => {
    for (const cls of LADDER) {
      const a = generateLadderEntrant(cls, 424242, 0, 'hard');
      const b = generateLadderEntrant(cls, 424242, 0, 'hard');
      expect(a).to.deep.equal(b, `hard ${cls} must be deterministic per seed`);
      expect(a.battles.length).to.equal(7);
      let total = 0;
      for (const battle of a.battles) {
        expect(battle.length).to.equal(5);
        for (const v of battle) {
          expect(Number.isInteger(v)).to.equal(true);
          expect(v).to.be.at.least(0);
          expect(v).to.be.at.most(700);
        }
        total += battle.reduce((x, y) => x + y, 0);
      }
      expect(total, `hard ${cls} board total`).to.equal(700);
    }
    // Uniform is the hard board's own buzzer default: 700 / 35 = 20 a stat.
    for (const battle of generateLadderEntrant('uniform', 7, 0, 'hard').battles) {
      expect(battle).to.deep.equal([20, 20, 20, 20, 20]);
    }
    // The stacked classes concede exactly two battles and hold 140 in each
    // of the other five — the shape the README documents.
    for (const cls of ['heuristic', 'optimised'] as const) {
      const e = generateLadderEntrant(cls, 31337, 0, 'hard');
      const sums = e.battles.map((b) => b.reduce((x, y) => x + y, 0));
      expect(sums.filter((v) => v === 0).length, `${cls} concedes two`).to.equal(2);
      expect(sums.filter((v) => v === 140).length, `${cls} stacks five`).to.equal(5);
    }
    // The easy ladder is untouched by the hard one: same seed, same bytes as
    // before Phase B (the nightly diff of the easy artifacts pins the rest).
    expect(generateLadderEntrant('random', 424242)).to.deep.equal(
      generateLadderEntrant('random', 424242, 0, 'easy')
    );
  });

  it('studies every pool size, full and at its minimum field, from the shared constants', () => {
    expect(STUDY_FIELDS.map((f) => [f.capacity, f.seats])).to.deep.equal(
      POOL_CAPACITIES.flatMap((c) => [
        [c, c],
        [c, MIN_FIELD_BY_CAPACITY[c]],
      ])
    );
  });

  it('a field of 5 or 10 rotates its extra entries so every class is equally represented over four pools', () => {
    for (const seats of [5, 10]) {
      const totals = LADDER.map(() => 0);
      for (let seed = 1000; seed < 1004; seed++) {
        const counts = classCounts(seats, seed);
        expect(counts.reduce((a, b) => a + b, 0)).to.equal(seats);
        for (const c of counts) expect(c).to.be.oneOf([Math.floor(seats / 4), Math.floor(seats / 4) + 1]);
        counts.forEach((c, i) => (totals[i] += c));
        const population = ladderPopulation(seed, seats);
        expect(population.length).to.equal(seats);
        LADDER.forEach((cls, i) =>
          expect(population.filter((e) => e.strategy === cls).length).to.equal(counts[i])
        );
      }
      expect(new Set(totals).size, `${seats}: equal totals over four pools`).to.equal(1);
    }
    // A field that divides by four is the old, equal split — unchanged.
    expect(classCounts(64, 7)).to.deep.equal([16, 16, 16, 16]);
    expect(classCounts(8, 7)).to.deep.equal([2, 2, 2, 2]);
    expect(() => classCounts(3, 1)).to.throw(/at least one entrant per class/);
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
  it('is deterministic, conserves every prize pool, and separates the ladder ends', async function () {
    this.timeout(300_000);
    // Four pools per run: a multiple of four, so the 5- and 10-player
    // fields rotate their extra entries evenly.
    const params = { pools: 4, baseSeed: 555000 };
    const a = await runSkillEvidence(params);
    const b = await runSkillEvidence(params);
    expect(a.csv).to.equal(b.csv, 'same parameters must reproduce the CSV byte for byte');
    expect(a.report).to.equal(b.report);

    // Every field the rules offer, in order, each on its own table.
    expect(a.fields.map((f) => [f.capacity, f.seats])).to.deep.equal(
      STUDY_FIELDS.map((f) => [f.capacity, f.seats])
    );
    for (const f of a.fields) {
      expect([...f.table]).to.deep.equal([...LADDER_TABLES[f.capacity]]);
      for (const r of f.rows) expect(r.entrants, `${f.seats} of ${f.capacity} ${r.cls}`).to.equal((f.seats * params.pools) / 4);
    }
    expectConserved(a.fields, params.pools);

    // The one ordering robust even at a small sample: a three-stat
    // concentrator beats the untouched pentagon (uniform loses its trio
    // stats against every concentrated opponent).
    const byClass = new Map(a.rows.map((r) => [r.cls, r]));
    expect(a.rows).to.equal(a.fields.find((f) => f.capacity === 64 && f.seats === 64)!.rows);
    const uniform = byClass.get('uniform')!;
    const optimised = byClass.get('optimised')!;
    expect(optimised.paidEntries).to.be.greaterThan(uniform.paidEntries);
    expect(optimised.paidLamports > uniform.paidLamports).to.equal(true);

    // The CSV: the declared columns, a capacity beside the field, integer
    // counts beside every rate, and nothing a float could have produced.
    const json = csvToJson(a.csv);
    expect(json.columns).to.deep.equal([...CSV_COLUMNS]);
    expect(json.rows.length).to.equal(a.fields.length * 7);
    for (const row of json.rows) {
      expect(Number(row.capacity)).to.be.oneOf([...POOL_CAPACITIES]);
      expect(row.rank1_rate_pct).to.match(/^\d+\.\d{3}$/);
      expect(row.paid_rate_pct).to.match(/^\d+\.\d{2}$/);
      expect(row.paid_rate_vs_random_pp).to.match(/^[+-]?\d+\.\d{2}$/);
      expect(row.return_per_entry).to.match(/^\d+\.\d{4}$/);
      expect(row.total_paid_lamports).to.match(/^\d+$/);
    }
    // In the homogeneous runs every class returns exactly the prize pool
    // over the field: conservation, printed.
    const full64 = json.rows.filter((r) => r.run === 'homogeneous' && r.capacity === '64' && r.seats === '64');
    for (const r of full64) expect(r.return_per_entry).to.equal('0.6250');
    const min64 = json.rows.filter((r) => r.run === 'homogeneous' && r.capacity === '64' && r.seats === '40');
    for (const r of min64) expect(r.return_per_entry).to.equal('1.0000');

    // CSV never contains a bare 64-integer JSON array (the gitleaks
    // keypair-shape rule) — CSV rows are unbracketed by construction.
    expect(a.csv.includes('[')).to.equal(false);

    // The report describes the Ladder, in SOL, and no longer the one paid
    // place it replaced; and it never states a prize as a multiple.
    expect(a.report).to.include('The Ladder (D-E19)');
    expect(a.report).to.include('| 64 | 40 | 16 | 1.2; 0.6; 0.3; 0.3; 0.2 each, 5th–8th; 0.1 each, 9th–16th | 4 |');
    expect(a.report).to.include('| 8 | 5 | 2 | 0.3; 0.2 | 0.5 |');
    expect(a.report).to.not.match(/one paid place/i);
    expect(a.report).to.not.match(/× ?entry/);

    // The homogeneous runs (v2 amendment): one row per class per field.
    expect(a.homogeneous.map((r) => r.cls)).to.deep.equal(['random', 'heuristic', 'optimised']);
  });

  it('runs the hard board through the same crank: conserves every prize pool, stacking beats the default', async function () {
    this.timeout(300_000);
    const params = { pools: 4, baseSeed: 556000, mode: 'hard' as const };
    const a = await runSkillEvidence(params);
    const b = await runSkillEvidence(params);
    expect(a.csv).to.equal(b.csv, 'the hard study must reproduce byte for byte');
    expect(a.report).to.include('(hard board)');
    expect(a.report).to.include('## Draw rate under the hard rule');
    expectConserved(a.fields, params.pools);
    const byClass = new Map(a.rows.map((r) => [r.cls, r]));
    // A conceded battle loses 5–0 to the even split, but the five stacked
    // battles beat it 3–2 each: five battles to two, every time.
    expect(byClass.get('optimised')!.paidEntries).to.be.greaterThan(byClass.get('uniform')!.paidEntries);
    // Every run carries its draw tally, and the mixed run has some draws (the
    // uniform entrants draw every battle against each other).
    for (const f of a.fields) {
      expect(f.draws.map((d) => d.run)).to.deep.equal(['mixed', 'random', 'heuristic', 'optimised']);
      for (const d of f.draws) expect(d.comparisons > 0n).to.equal(true);
    }
    expect(a.fields.find((f) => f.seats === 64)!.draws[0].draws > 0n).to.equal(true);
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
