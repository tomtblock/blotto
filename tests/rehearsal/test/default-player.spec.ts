/**
 * The default player — the one claim the skill evidence makes about a real
 * person rather than about a strategy class.
 *
 * `docs/skill-evidence/REPORT.md` says, in "Leaving the allocation on its
 * default", that the study's `uniform` class IS what a player produces by
 * opening the flow and touching nothing. That sentence is only true while
 * two independently-maintained things agree:
 *
 *   1. the app opens every allocation screen on 20/20/20/20/20
 *      (`EVEN_SPLIT`, app/src/battle/allocation.ts), and
 *   2. the study's `uniform` class allocates 20/20/20/20/20 in all seven
 *      battles (tests/rehearsal/src/ladder.ts).
 *
 * Nothing else connects them. Either could be changed on its own by someone
 * with no idea the published evidence depends on it, and the report would go
 * on making a claim about a player who no longer exists. So this reads the
 * app's constant out of its source and holds the two together.
 *
 * Reading the file as TEXT is deliberate. The app is a Next.js/ESM package
 * with its own build; importing it into this CommonJS mocha run would couple
 * two toolchains to make one assertion. The regex is pinned to the exact
 * declaration and fails loudly — with instructions — if that form moves.
 */

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { join } from 'path';
import { generateLadderEntrant } from '../src/ladder';

const ALLOCATION_TS = join(__dirname, '..', '..', '..', 'app', 'src', 'battle', 'allocation.ts');

/** The app's `EVEN_SPLIT`, read from its source. */
function appEvenSplit(): number[] {
  const src = readFileSync(ALLOCATION_TS, 'utf8');
  const m = src.match(/export const EVEN_SPLIT: Allocation = \[([^\]]+)\]/);
  expect(
    m,
    `could not find "export const EVEN_SPLIT: Allocation = [...]" in ${ALLOCATION_TS}. ` +
      'If that declaration was renamed or reshaped, update this test AND check that ' +
      'docs/skill-evidence/REPORT.md still tells the truth about the default player.'
  ).to.not.equal(null);
  return m![1].split(',').map((v) => Number(v.trim()));
}

describe('the default player — app default == the study uniform class', () => {
  it("the app's EVEN_SPLIT is a five-stat allocation summing to 100", () => {
    const even = appEvenSplit();
    expect(even.length, 'five stats').to.equal(5);
    expect(even.reduce((a, b) => a + b, 0), 'sums to exactly 100').to.equal(100);
  });

  it('every uniform battle equals the app default, so the published claim holds', () => {
    const even = appEvenSplit();
    // Several seeds: uniform must be seed-independent — that is what makes it
    // "the default" rather than one draw from a distribution.
    for (const seed of [1, 42, 20260827, 999999]) {
      const entrant = generateLadderEntrant('uniform', seed);
      expect(entrant.battles.length, 'seven battles').to.equal(7);
      for (const [i, battle] of entrant.battles.entries()) {
        expect(
          Array.from(battle),
          `uniform battle ${i} at seed ${seed} must equal the app's EVEN_SPLIT ` +
            `[${even}] — REPORT.md's default-player section claims they are the same`
        ).to.deep.equal(even);
      }
    }
  });

  it('the default is beaten by any three-stat concentration, 3-2, by construction', () => {
    // The report's structural argument, asserted rather than asserted-about:
    // a battle goes to whoever takes three of five stats. Against a trio
    // concentration the flat split takes only the two starved stats.
    const even = appEvenSplit();
    const concentrated = [33, 33, 34, 0, 0];
    const flatWins = even.filter((v, i) => v > concentrated[i]).length;
    const concentratedWins = concentrated.filter((v, i) => v > even[i]).length;
    expect(concentratedWins, 'the concentrated side takes its three funded stats').to.equal(3);
    expect(flatWins, 'the flat side takes only the two starved stats').to.equal(2);
    expect(concentratedWins > flatWins, 'so the default loses the battle').to.equal(true);
  });
});
