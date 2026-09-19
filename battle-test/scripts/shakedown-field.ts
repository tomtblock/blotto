/**
 * `shakedown-field.ts` — allocations for a pool that is NOT a test.
 *
 * Pool 22 is a shakedown of T6's failure path, recorded as an observation
 * (`registry/pool-22.observation.md`). It still needs 63 headless allocations,
 * and those have to come from somewhere reproducible — "I generated some
 * numbers" is not a thing anybody can check afterwards.
 *
 * Deliberately NOT `oracle.ts`, and deliberately NOT writing a `*.plan.json`:
 *
 *   - `oracle.ts` builds FROZEN PREDICTIONS. Its output carries expected ranks,
 *     a results root, pass criteria and a freeze record. A shakedown claims
 *     none of that, and a file that looked like a plan would eventually be read
 *     as one.
 *   - CI validates `registry/*.plan.json` and the results gate reads verdicts
 *     out of `RESULTS.md`. A field file named `*.field.json` is swept by
 *     neither, which is correct: there is nothing here to hold to a prediction.
 *
 * What it DOES share with the tests is the allocation invariant, because that
 * is a property of every entry this project ever makes and not of the ones
 * being scored: five non-negative integers summing to exactly 100, in the
 * fixed stat order, from `src/populations.ts` — the same generators the plans
 * use, at different seeds.
 *
 * One seat is a `wall` (three stats at 26+, two at zero, rotating). That is
 * not decoration: it makes a wallet WE hold the near-certain winner, so the
 * 4 SOL pot returns to the test roster instead of stopping in a wallet the
 * run cannot spend from. It is near-certain rather than certain because UI-A
 * already sits in pool 22 with an allocation nobody here chose or can see.
 *
 * Run (from battle-test/):
 *   npx ts-node --transpile-only --compiler-options \
 *     '{"module":"commonjs","moduleResolution":"node"}' scripts/shakedown-field.ts \
 *     --out registry/pool-22.field.json --wall-seed 2200 --field-base 2201 --seats 63
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { cappedField, wall, distinctShapes, type Entrant } from '../src/populations';

const flag = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

function main(): void {
  const out = flag('out') ?? 'registry/pool-22.field.json';
  const wallSeed = Number(flag('wall-seed') ?? 2200);
  const fieldBase = Number(flag('field-base') ?? 2201);
  const count = Number(flag('seats') ?? 63);
  if (!Number.isInteger(count) || count < 2 || count > 64) {
    throw new Error(`--seats must be 2..64, got ${flag('seats')}`);
  }

  const seats: Record<string, unknown>[] = [];
  const push = (wallet: string, role: string, seed: number, e: Entrant) =>
    seats.push({
      wallet,
      route: 'direct',
      role,
      generator: e.generator,
      seed,
      battles: e.battles,
      distinctShapes: distinctShapes(e.battles),
    });

  push('W00', 'wall', wallSeed, wall(wallSeed));
  for (let i = 1; i < count; i++) {
    const seed = fieldBase + i;
    push(`W${String(i).padStart(2, '0')}`, 'field', seed, cappedField(seed));
  }

  // The one allocation signal that hard-blocks (R11) is two entrants sharing a
  // seven-battle set. A shakedown that tripped it would tell us nothing about
  // oversubscription and everything about our own seeds, so check here rather
  // than find out at settlement.
  const seen = new Map<string, string>();
  for (const s of seats) {
    const fp = JSON.stringify(s.battles);
    const twin = seen.get(fp);
    if (twin) throw new Error(`${s.wallet} and ${twin} share a seven-battle set — pick other seeds`);
    seen.set(fp, s.wallet as string);
    if ((s.distinctShapes as number) < 3) {
      throw new Error(`${s.wallet} carries only ${s.distinctShapes} distinct shapes — allocation_entropy fires strong at 2 or fewer`);
    }
  }

  const doc = {
    schema: 'blotto-shakedown-field/1',
    notAPlan:
      'This is NOT a frozen prediction and nothing here is a pass criterion. It is the allocation ' +
      'set for pool 22, which runs as a shakedown of T6\'s failure path and is recorded in ' +
      'registry/pool-22.observation.md. Regenerate with scripts/shakedown-field.ts and the seeds ' +
      'below to reproduce it exactly.',
    generatedBy: 'scripts/shakedown-field.ts',
    wallSeed,
    fieldBase,
    seats,
  };
  writeFileSync(resolve(process.cwd(), out), JSON.stringify(doc, null, 2) + '\n');
  console.log(`wrote ${out} — ${seats.length} seats (1 wall at seed ${wallSeed}, ${seats.length - 1} field from ${fieldBase + 1})`);
}

try {
  main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
