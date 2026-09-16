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
 * All three survived a copy edit made on 2026-09-15 — three days after the
 * rule moved — and the repository's eleven gates all reported clean, because
 * none of them looks at the words on the screen. `check-mirrors.py` pins the
 * Rust constants to their TypeScript mirror; `mirror.spec.ts` does it from
 * the other side. Nothing pinned either to the copy that describes them.
 *
 * That matters more than a wrong number usually does. PID §8.6 requires the
 * fill deadline and the refund rule to be stated accurately and stated
 * BEFORE payment, and the sealed panel is the screen a player reads having
 * just paid. A player told "below 52 refunds" who then watches a 41-seat
 * pool play has been told the wrong rule at the worst possible moment.
 *
 * WHAT IT CHECKS. One rule, deliberately narrow, because a gate that tries
 * to police every number in the copy module will be switched off inside a
 * month:
 *
 *   A value a shared constant USED TO HAVE must not appear in any rendered
 *   copy string — as digits or as an English number word.
 *
 * Superseded values are declared below, beside the constant they belong to
 * and the register row that moved them. That declaration is the maintenance
 * cost, and it is paid at exactly the right moment: the change that moves a
 * constant is the change that adds the row, and adding the row is what
 * surfaces every string still carrying the old figure.
 *
 * The number WORDS are not decoration. The landing page spelled it out, so a
 * digit-only sweep would have passed the surface a new player meets first.
 *
 * THE AUTHORITY IS THE PROGRAM. Current values are read out of
 * `programs/blotto_cup/src/constants.rs` as text, the same way
 * `mirror.spec.ts` reads them — so this gate needs no workspace installed,
 * and the chain of custody is: Rust constant -> (check-mirrors.py,
 * mirror.spec.ts) -> TypeScript constant -> (this gate) -> published copy.
 * Each link has exactly one owner.
 *
 * WHAT IT DOES NOT CHECK. That a number which is currently correct is
 * DERIVED rather than typed. `src/copy/field-size.test.ts` pins the three
 * strings above to the constant, and the convention is stated in the copy
 * module beside `rules.howToEnter`. This gate is the net beneath both, for
 * the case where someone adds a fourth surface nobody thought to pin.
 *
 * Run: npx tsx scripts/check-published-numbers.ts [--self-test]
 * Exit: 0 clean · 1 the tree is wrong · 2 this gate is broken.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '..');

/** A constant whose value has moved, and every value it has had before now. */
interface Watched {
  /** The name in programs/blotto_cup/src/constants.rs. */
  readonly rust: string;
  /** What a reader would call it. */
  readonly describes: string;
  /**
   * Values this constant used to carry. Add to this in the SAME change that
   * moves the constant — that is the whole mechanism.
   */
  readonly superseded: readonly { value: number; note: string }[];
}

export const WATCHED: readonly Watched[] = [
  {
    rust: 'MIN_SEATS',
    describes: 'the minimum field a pool plays with',
    superseded: [
      { value: 52, note: 'D-E4 (2026-09-06), superseded by R7-b on 2026-09-12' },
      { value: 32, note: 'PID v0.5 §2, superseded by D-E4 on 2026-09-06' },
    ],
  },
  {
    rust: 'CAPACITY',
    describes: 'the seats in a pool',
    // Has never moved. Declared anyway so that the day it does, the gate is
    // already watching and the mover has an obvious place to record it.
    superseded: [],
  },
];

/** Number words for every value we watch, so a spelled-out figure is caught.
 * Only the values that can appear need a word — this is not a general
 * number-to-words routine, and should not become one. */
const WORDS: Readonly<Record<number, string>> = {
  32: 'thirty-two',
  40: 'forty',
  52: 'fifty-two',
  64: 'sixty-four',
};

/** Read a scalar out of constants.rs as text. Mirrors mirror.spec.ts. */
export function rustScalar(rust: string, name: string): number {
  const m = rust.match(new RegExp(`pub const ${name}:\\s*\\w+\\s*=\\s*([0-9_]+)`));
  if (!m) throw new Error(`constants.rs: no scalar named ${name}`);
  return Number(m[1].replace(/_/g, ''));
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

export function checkPublishedNumbers(input: {
  readonly rustConstants: string;
  readonly surfaces: readonly Surface[];
}): string[] {
  const failures: string[] = [];

  for (const w of WATCHED) {
    const current = rustScalar(input.rustConstants, w.rust);

    for (const { value, note } of w.superseded) {
      if (value === current) {
        failures.push(
          `published-numbers(gate): ${w.rust} is ${current}, but ${value} is listed as ` +
            `superseded (${note}). One of the two is wrong.`
        );
        continue;
      }
      const digits = new RegExp(`(?<![0-9])${value}(?![0-9])`);
      const word = WORDS[value];
      const wordRe = word ? new RegExp(word, 'i') : null;

      for (const s of input.surfaces) {
        for (const lit of renderedStrings(s.source)) {
          const hitDigits = digits.test(lit);
          const hitWord = wordRe ? wordRe.test(lit) : false;
          if (!hitDigits && !hitWord) continue;
          const how = hitDigits ? `"${value}"` : `"${word}"`;
          failures.push(
            `${s.path}: published copy still carries ${how}, a superseded value of ` +
              `${w.rust} (${w.describes}); it is now ${current}. ${note}.\n` +
              `      in: ${lit.slice(0, 120)}${lit.length > 120 ? '…' : ''}`
          );
        }
      }
    }
  }
  return failures;
}

/* --------------------------------------------------------------------- */

function selfTest(): boolean {
  const ok = (name: string, cond: boolean) => {
    if (!cond) console.error(`self-test FAILED: ${name}`);
    return cond;
  };
  const rustConstants = 'pub const CAPACITY: u16 = 64;\npub const MIN_SEATS: u16 = 40;\n';
  const clean: Surface[] = [
    {
      path: 'probe/clean.ts',
      source: `
        // R7-b moved it from 52 to 40 on 2026-09-12 — this note must survive.
        /* An older draft said fifty-two seated; that is the point of the note. */
        export const COPY = {
          checkBack: (minSeats: number) => \`plays at 64, or at its deadline with at least \${minSeats}\`,
          steps: 'all sixty-four seats filled',
        };`,
    },
  ];

  let pass = true;
  pass =
    ok('clean copy passes, and history in comments survives', checkPublishedNumbers({ rustConstants, surfaces: clean }).length === 0) && pass;

  pass =
    ok(
      'a superseded value as DIGITS in a rendered string fails',
      checkPublishedNumbers({
        rustConstants,
        surfaces: [{ path: 'probe/digits.ts', source: "const a = 'at its deadline with at least 52';" }],
      }).some((f) => f.includes('"52"') && f.includes('MIN_SEATS'))
    ) && pass;

  pass =
    ok(
      'a superseded value spelled as a WORD fails — the landing-page case',
      checkPublishedNumbers({
        rustConstants,
        surfaces: [{ path: 'probe/word.ts', source: "const a = 'or at least fifty-two seated';" }],
      }).some((f) => f.includes('"fifty-two"'))
    ) && pass;

  pass =
    ok(
      'a superseded value inside a template literal fails',
      checkPublishedNumbers({
        rustConstants,
        surfaces: [{ path: 'probe/tpl.ts', source: 'const a = `First place, 52 seats`;' }],
      }).length > 0
    ) && pass;

  pass =
    ok(
      'a superseded value in a LINE comment is allowed',
      checkPublishedNumbers({
        rustConstants,
        surfaces: [{ path: 'probe/line.ts', source: "// it was 52 under D-E4\nconst a = 'ok';" }],
      }).length === 0
    ) && pass;

  pass =
    ok(
      'a superseded value in a BLOCK comment is allowed',
      checkPublishedNumbers({
        rustConstants,
        surfaces: [{ path: 'probe/block.ts', source: "/* fifty-two, historically */\nconst a = 'ok';" }],
      }).length === 0
    ) && pass;

  pass =
    ok(
      'a longer number merely CONTAINING the value does not trip it',
      checkPublishedNumbers({
        rustConstants,
        surfaces: [{ path: 'probe/adj.ts', source: "const a = 'pool 452 and 5200 lamports';" }],
      }).length === 0
    ) && pass;

  pass =
    ok(
      'the gate refuses a superseded list that names the CURRENT value',
      checkPublishedNumbers({
        rustConstants: 'pub const CAPACITY: u16 = 64;\npub const MIN_SEATS: u16 = 52;\n',
        surfaces: [],
      }).some((f) => f.includes('published-numbers(gate)'))
    ) && pass;

  pass =
    ok(
      'a missing constant is a broken gate, not a clean tree',
      (() => {
        try {
          rustScalar('pub const CAPACITY: u16 = 64;', 'MIN_SEATS');
          return false;
        } catch {
          return true;
        }
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
  'app/src/app/rules/rules.config.ts',
  'app/src/app/fair-play/fair-play.config.ts',
];

function main(): void {
  if (!selfTest()) {
    console.error(
      'published-numbers: THE GATE ITSELF IS BROKEN — fix the check, never the probe.'
    );
    process.exit(2);
  }
  if (process.argv.includes('--self-test')) {
    console.log('published-numbers: self-test passed');
    return;
  }

  const failures = checkPublishedNumbers({
    rustConstants: readFileSync(
      resolve(ROOT, 'programs', 'blotto_cup', 'src', 'constants.rs'),
      'utf8'
    ),
    surfaces: SURFACES.map((p) => ({ path: p, source: readFileSync(resolve(ROOT, p), 'utf8') })),
  });

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
