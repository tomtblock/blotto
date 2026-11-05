/**
 * The published-numbers gate.
 *
 * WHY THIS EXISTS. On 2026-09-12 R7-b moved the minimum field from 52 to 40.
 * The program changed, `rules.config.ts` changed because it already derived
 * its number, and three player-facing strings did not:
 *
 *   - the LANDING PAGE's how-it-works step 3, "at least fifty-two seated";
 *   - the SEALED PANEL, read immediately AFTER paying, "at least 52";
 *   - the FAIR PLAY skill table's second column, headed "First place, 52
 *     seats" over data computed at 40.
 *
 * All three survived a copy edit made three days after the rule moved, and
 * every gate reported clean, because none of them looks at the words on the
 * screen. PID §8.6 requires the fill deadline and the refund rule to be
 * stated accurately and BEFORE payment; a player told the wrong rule on the
 * screen they read having just paid has been told it at the worst moment.
 *
 * WHAT IT CHECKS. One rule, deliberately narrow, because a gate that tries
 * to police every number in the copy module will be switched off inside a
 * month:
 *
 *   A RETIRED figure or claim must not appear in any rendered copy string —
 *   as digits, as an English number word, or as the phrase.
 *
 * Retired figures and claims are declared below, each with the register row
 * that retired it. That declaration is the maintenance cost, paid at the
 * moment a rule moves: the change that moves it adds the row, and adding the
 * row surfaces every string still carrying the old figure.
 *
 * THE LADDER (D-E19, 2026-11-05) changed what "retired" can mean. Pools now
 * hold 8, 16, 32 or 64 players with minimum fields of 5, 10, 20 and 40, so a
 * figure is CURRENT if it is any pool size or any minimum field — and 32, a
 * minimum field retired in 2026-09, is a pool size again. The gate therefore
 * reads `POOL_CAPACITIES`, `LADDER_MIN_SEATS` and `LADDER_TABLES` out of
 * constants.rs and refuses (as a broken gate, not a dirty tree) any retired
 * figure that is current again. What stays retired:
 *
 *   - 52 as a minimum field (D-E4; R7-b moved it; `MIN_SEATS_V1` keeps it
 *     only for the pools that entered under it);
 *   - winner-takes-all and one-paid-place claims (D-E2; every Ladder pool
 *     pays its top quarter — the gate checks the tables still do);
 *   - the 1024ths prize grid (`PRIZE_BANDS_1024`, retired by D-E19).
 *
 * THE AUTHORITY IS THE PROGRAM. Current values are read out of
 * `programs/blotto_cup/src/constants.rs` as text, so this gate needs no
 * workspace installed, and the chain of custody is: Rust constant ->
 * (check-mirrors.py, mirror.spec.ts) -> TypeScript constant -> (this gate)
 * -> published copy. Each link has exactly one owner.
 *
 * WHAT IT DOES NOT CHECK. That a number which is currently correct is
 * DERIVED rather than typed — `src/copy/field-size.test.ts` and the copy
 * module's convention own that. This gate is the net beneath both.
 *
 * Run: npx tsx scripts/check-published-numbers.ts [--self-test]
 * Exit: 0 clean · 1 the tree is wrong · 2 this gate is broken.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '..');

/** A figure that used to be a published number and no longer is. */
interface RetiredFigure {
  readonly value: number;
  /** Spelled-out forms a page might use; matched case-insensitively. */
  readonly words: readonly string[];
  readonly describes: string;
  readonly note: string;
}

/** A claim that described a retired rule. */
interface RetiredClaim {
  readonly pattern: RegExp;
  readonly describes: string;
  readonly note: string;
}

export const RETIRED_FIGURES: readonly RetiredFigure[] = [
  {
    value: 52,
    words: ['fifty-two', 'fifty two'],
    describes: 'the minimum field',
    note:
      'D-E4 (2026-09-06), superseded by R7-b on 2026-09-12; the Ladder (D-E19) minimum fields are ' +
      'per size. MIN_SEATS_V1 keeps 52 only for the pools that entered under it',
  },
  {
    value: 1024,
    words: [],
    describes: 'the 1024ths prize grid',
    note: 'PRIZE_BANDS_1024 and the 1024-lamport rule were retired by D-E19 — every prize is a whole multiple of the entry',
  },
  // 32 was the minimum field of PID v0.5 (superseded by D-E4 on 2026-09-06).
  // It is NOT listed: since D-E19 it is a pool size, and the consistency
  // check below would refuse it as a current figure.
];

export const RETIRED_CLAIMS: readonly RetiredClaim[] = [
  {
    pattern: /\bwinners?[\s-]+takes?\b/i,
    describes: 'a winner-takes-all claim',
    note: 'D-E2, superseded by D-E19 — every pool pays its top quarter',
  },
  {
    // "More than one place is paid" is the CURRENT rule and must pass.
    pattern: /(?<!than )\b(?:one|single|1) paid place\b|(?<!than )\bone place is paid\b|\bonly (?:the )?(?:first|1st|top) place (?:is )?paid\b/i,
    describes: 'a one-paid-place claim',
    note: 'D-E2, superseded by D-E19 — every pool pays its top quarter',
  },
  {
    pattern: /\b1024ths?\b/i,
    describes: 'the 1024ths prize grid',
    note: 'retired by D-E19',
  },
];

/** A 1-D integer array out of constants.rs, e.g. `pub const X: [u16; 4] = [5, 10, 20, 40];`. */
export function rustArray(rust: string, name: string): number[] {
  const m = rust.match(new RegExp(`pub const ${name}:\\s*\\[[^\\]]*\\]\\s*=\\s*\\[([^\\]]*)\\]`));
  if (!m) throw new Error(`constants.rs: no array named ${name}`);
  const values = m[1]
    .split(',')
    .map((v) => v.trim().replace(/_/g, ''))
    .filter((v) => v !== '');
  if (values.length === 0 || values.some((v) => !/^[0-9]+$/.test(v))) {
    throw new Error(`constants.rs: ${name} is not a list of integers`);
  }
  return values.map(Number);
}

/** A 2-D integer table out of constants.rs (`LADDER_TABLES`). */
export function rustTable(rust: string, name: string): number[][] {
  const start = rust.search(new RegExp(`pub const ${name}:`));
  if (start < 0) throw new Error(`constants.rs: no table named ${name}`);
  const eq = rust.indexOf('=', start);
  const end = rust.indexOf('];', eq);
  if (eq < 0 || end < 0) throw new Error(`constants.rs: ${name} is not a table`);
  const body = rust.slice(eq + 1, end + 1);
  const rows = [...body.matchAll(/\[([0-9_,\s]+)\]/g)].map((r) =>
    r[1]
      .split(',')
      .map((v) => v.trim().replace(/_/g, ''))
      .filter((v) => v !== '')
      .map(Number)
  );
  if (rows.length === 0) throw new Error(`constants.rs: ${name} has no rows`);
  return rows;
}

/**
 * Every string a user can actually read, with its comments removed.
 *
 * Comments are stripped rather than tolerated because the repository's
 * convention is that a superseded value is ANNOTATED, not erased — the copy
 * module explains beside each fixed string which figure it used to carry and
 * which register row moved it. Those notes are the record and must survive;
 * it is only the rendered text that has to be clean.
 */
export function renderedStrings(source: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i++;
      let lit = '';
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') {
          lit += source[i + 1] ?? '';
          i += 2;
          continue;
        }
        lit += source[i];
        i++;
      }
      i++;
      out.push(lit);
      continue;
    }
    i++;
  }
  return out;
}

export interface Surface {
  /** Repo-relative path, for the failure message. */
  readonly path: string;
  readonly source: string;
}

/** The figures the program publishes today: every pool size and every minimum field. */
export function currentFigures(rustConstants: string): { capacities: number[]; minFields: number[]; tables: number[][] } {
  const capacities = rustArray(rustConstants, 'POOL_CAPACITIES');
  const minFields = rustArray(rustConstants, 'LADDER_MIN_SEATS');
  const tables = rustTable(rustConstants, 'LADDER_TABLES');
  return { capacities, minFields, tables };
}

/** A standalone figure: not part of a longer number, a decimal or a thousands group. */
function figurePattern(value: number): RegExp {
  return new RegExp(`(?<![0-9.,])${value}(?![0-9]|[.,][0-9])`);
}

export function checkPublishedNumbers(input: {
  readonly rustConstants: string;
  readonly surfaces: readonly Surface[];
}): string[] {
  const failures: string[] = [];
  const { capacities, minFields, tables } = currentFigures(input.rustConstants);

  // The gate's own consistency, first. A retired figure that is current
  // again would fail every honest page; a phrase ban that no longer holds
  // would too. Either is a broken gate, not a dirty tree.
  if (capacities.length !== minFields.length || capacities.length !== tables.length) {
    failures.push(
      `published-numbers(gate): POOL_CAPACITIES (${capacities.length}), LADDER_MIN_SEATS ` +
        `(${minFields.length}) and LADDER_TABLES (${tables.length}) disagree on how many pool sizes exist.`
    );
  }
  const current = new Set([...capacities, ...minFields]);
  for (const r of RETIRED_FIGURES) {
    if (current.has(r.value)) {
      failures.push(
        `published-numbers(gate): ${r.value} is listed as retired (${r.describes}) but is a current ` +
          `pool size or minimum field. One of the two is wrong.`
      );
    }
  }
  const paidPlaces = tables.map((row) => row.filter((m) => m > 0).length);
  if (paidPlaces.some((n) => n <= 1)) {
    failures.push(
      'published-numbers(gate): a LADDER_TABLES row pays one place, so the one-paid-place claim is ' +
        'not retired any more. Revisit RETIRED_CLAIMS before relying on this gate.'
    );
  }
  if (failures.length > 0) return failures;

  for (const s of input.surfaces) {
    for (const lit of renderedStrings(s.source)) {
      for (const r of RETIRED_FIGURES) {
        const hitDigits = figurePattern(r.value).test(lit);
        const word = r.words.find((w) => new RegExp(w, 'i').test(lit));
        if (!hitDigits && !word) continue;
        failures.push(
          `${s.path}: published copy still carries "${hitDigits ? r.value : word}", a retired figure ` +
            `(${r.describes}). ${r.note}.\n      in: ${lit.slice(0, 120)}${lit.length > 120 ? '…' : ''}`
        );
      }
      for (const c of RETIRED_CLAIMS) {
        const m = c.pattern.exec(lit);
        if (!m) continue;
        failures.push(
          `${s.path}: published copy still makes ${c.describes} ("${m[0]}"). ${c.note}.\n` +
            `      in: ${lit.slice(0, 120)}${lit.length > 120 ? '…' : ''}`
        );
      }
    }
  }
  return failures;
}

/* --------------------------------------------------------------------- */

const PROBE_CONSTANTS = `
pub const CAPACITY: u16 = 64;
pub const POOL_CAPACITIES: [u16; 4] = [8, 16, 32, 64];
pub const LADDER_TABLES: [[u8; MAX_PAID_PLACES]; 4] = [
    [3, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [5, 3, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [8, 4, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
    [12, 6, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1],
];
pub const LADDER_MIN_SEATS: [u16; 4] = [5, 10, 20, 40];
pub const MIN_SEATS_V1: u16 = 52;
`;

function selfTest(): boolean {
  const ok = (name: string, cond: boolean) => {
    if (!cond) console.error(`self-test FAILED: ${name}`);
    return cond;
  };
  const run = (source: string, rustConstants = PROBE_CONSTANTS) =>
    checkPublishedNumbers({ rustConstants, surfaces: [{ path: 'probe.ts', source }] });

  let pass = true;
  pass =
    ok(
      'clean Ladder copy passes — every size including 32, every minimum field, history in comments',
      run(`
        // R7-b moved it from 52 to 40 on 2026-09-12 — this note must survive.
        /* An older draft said fifty-two seated and "winner takes all"; that is the point of the note. */
        export const COPY = {
          sizes: 'Pools of 8, 16, 32 or 64 players.',
          words: 'A thirty-two player pool plays with at least twenty.',
          floor: (minSeats: number) => \`plays at its size, or at its deadline with at least \${minSeats}\`,
          fields: 'at least 5, 10, 20 or 40',
          places: 'The top quarter of every pool is paid.',
        };`).length === 0
    ) && pass;

  pass = ok('a 32-player pool is a current size, not a retired floor', run("const a = 'a 32-player pool';").length === 0) && pass;

  pass =
    ok(
      'the retired floor as DIGITS fails',
      run("const a = 'at its deadline with at least 52';").some((f) => f.includes('"52"') && f.includes('minimum field'))
    ) && pass;

  pass =
    ok('the retired floor spelled as a WORD fails — the landing-page case', run("const a = 'or at least fifty-two seated';").some((f) => f.includes('"fifty-two"'))) &&
    pass;

  pass = ok('a retired figure inside a template literal fails', run('const a = `First place, 52 seats`;').length > 0) && pass;

  pass =
    ok('a winner-takes-all claim fails', run("const a = 'Winner takes all.'; const b = 'winner-takes-all';").filter((f) => f.includes('winner-takes-all')).length === 2) &&
    pass;

  pass = ok('a one-paid-place claim fails', run("const a = 'There is one paid place.';").some((f) => f.includes('one-paid-place'))) && pass;

  pass =
    ok('"more than one place is paid" — the current rule — passes', run("const a = 'More than one place is paid.';").length === 0) && pass;

  pass =
    ok('the 1024ths grid fails as a phrase and as digits', run("const a = 'paid in 1024ths'; const b = 'a multiple of 1024 lamports';").length >= 3) &&
    pass;

  pass = ok('a retired figure in a LINE comment is allowed', run("// it was 52 under D-E4\nconst a = 'ok';").length === 0) && pass;

  pass = ok('a retired figure in a BLOCK comment is allowed', run("/* fifty-two, historically */\nconst a = 'ok';").length === 0) && pass;

  pass =
    ok(
      'a longer number or a decimal merely CONTAINING the figure does not trip it',
      run("const a = 'pool 452, 5200 lamports, 0.52 SOL, 1,052 entries, 10240 bytes';").length === 0
    ) && pass;

  pass =
    ok(
      'the gate refuses a retired figure that is a CURRENT minimum field',
      run('', PROBE_CONSTANTS.replace('[5, 10, 20, 40]', '[5, 10, 20, 52]')).some((f) => f.includes('published-numbers(gate)'))
    ) && pass;

  pass =
    ok(
      'the gate refuses a retired figure that is a CURRENT pool size',
      run('', PROBE_CONSTANTS.replace('[8, 16, 32, 64]', '[8, 16, 52, 64]')).some((f) => f.includes('published-numbers(gate)'))
    ) && pass;

  pass =
    ok(
      'the gate refuses the one-paid-place ban once a table pays one place',
      run('', PROBE_CONSTANTS.replace('[3, 2, 0,', '[5, 0, 0,')).some((f) => f.includes('pays one place'))
    ) && pass;

  pass =
    ok(
      'a missing constant is a broken gate, not a clean tree',
      (() => {
        try {
          run("const a = 'ok';", PROBE_CONSTANTS.replace('LADDER_MIN_SEATS', 'RENAMED'));
          return false;
        } catch {
          return true;
        }
      })()
    ) && pass;

  pass =
    ok(
      'the tables parse to four rows of sixteen',
      (() => {
        const t = rustTable(PROBE_CONSTANTS, 'LADDER_TABLES');
        return t.length === 4 && t.every((r) => r.length === 16) && t[3][0] === 12;
      })()
    ) && pass;

  return pass;
}

/**
 * The surfaces a player reads. `copy/index.ts` is the declared home of every
 * user-facing string (see its header), so it is the one that matters; the two
 * config modules are here because they are the other places a figure could be
 * typed rather than derived.
 */
const SURFACES = [
  'app/src/copy/index.ts',
  // The terms of service and the privacy notice (2026-09-19). Both are
  // dense with numbers a player relies on, and the terms are the AGREEMENT,
  // so a retired figure there is worse than one in a description.
  'app/src/copy/terms.ts',
  'app/src/copy/privacy.ts',
  'app/src/app/rules/rules.config.ts',
  'app/src/app/fair-play/fair-play.config.ts',
];

function main(): void {
  if (!selfTest()) {
    console.error('published-numbers: THE GATE ITSELF IS BROKEN — fix the check, never the probe.');
    process.exit(2);
  }
  if (process.argv.includes('--self-test')) {
    console.log('published-numbers: self-test passed');
    return;
  }

  let failures: string[];
  try {
    failures = checkPublishedNumbers({
      rustConstants: readFileSync(resolve(ROOT, 'programs', 'blotto_cup', 'src', 'constants.rs'), 'utf8'),
      surfaces: SURFACES.map((p) => ({ path: p, source: readFileSync(resolve(ROOT, p), 'utf8') })),
    });
  } catch (e) {
    console.error(`published-numbers: THE GATE CANNOT READ ITS INPUTS — ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }

  if (failures.some((f) => f.startsWith('published-numbers(gate)'))) {
    console.error('published-numbers: THE GATE ITSELF IS INCONSISTENT\n');
    for (const f of failures) console.error(`  ${f}`);
    process.exit(2);
  }
  if (failures.length > 0) {
    console.error('published-numbers: FAILED\n');
    for (const f of failures) console.error(`  ${f}`);
    console.error(
      '\nA number a player reads must be the number the program enforces. Take it from\n' +
        'the shared constant rather than typing it — `rules.howToEnter` in\n' +
        'app/src/copy/index.ts is the pattern, and its comment states the rule.\n' +
        'History belongs in a comment beside the string, which this gate ignores.'
    );
    process.exit(1);
  }
  console.log('published numbers: clean (self-test passed)');
}

if (require.main === module) main();
