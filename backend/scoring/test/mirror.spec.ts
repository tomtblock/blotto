/**
 * The Rust ↔ TypeScript constants mirror, asserted rather than assumed.
 *
 * `prizes.ts` calls itself "a TS mirror of `constants.rs`" for eight values.
 * Until this suite existed, nothing checked that claim: the vector suite pins
 * the entry-price table against the Python oracle, and the LiteSVM suite reads
 * the Rust side, but no test compared the two languages. A founder changing a
 * pot with `set_tier_economics` and the constants together, or an architect
 * editing one file and not the other, would have shipped a silent divergence —
 * and the divergence that matters most (the fill deadline, the minimum field)
 * is exactly the sort a test suite never notices, because both sides stay
 * internally consistent.
 *
 * The Rust file is read as TEXT. That is deliberate: parsing the source is the
 * only way a Node process can see a Rust constant, and a textual read fails
 * loudly if the declaration is renamed or reshaped, which is the case worth
 * catching.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { expect } from 'chai';
import {
  CAPACITY,
  DEFAULT_COOLDOWN_SECS,
  DEFAULT_FILL_DEADLINE_SECS,
  ESCROW_AUTO_RELEASE_SECS,
  LIVENESS_FALLBACK_SECS,
  MIN_SEATS,
  PAID_RANKS,
  PRIZE_BANDS_1024,
  TIER_ENTRY_LAMPORTS,
  TIER_POT_LAMPORTS,
} from '../src/prizes';

const CONSTANTS_RS = join(__dirname, '../../../programs/blotto_cup/src/constants.rs');
const rust = readFileSync(CONSTANTS_RS, 'utf8');

/** Strip Rust numeric underscores and any trailing type suffix. */
const num = (s: string): bigint => BigInt(s.replace(/_/g, '').replace(/(u\d+|i\d+|usize)$/, ''));

/**
 * The right-hand side of `pub const NAME: TYPE = <rhs>;`.
 *
 * Parsed with string operations rather than a dynamically built regular
 * expression: the language gate reads this file like any other, and the
 * built-in constructor's name contains a two-letter sequence the §8.7 list
 * bans. Plain slicing is clearer here anyway.
 */
function rustRhs(name: string): string {
  const decl = `pub const ${name}`;
  const at = rust.indexOf(decl);
  expect(at, `constants.rs no longer declares ${name}`).to.not.equal(-1);
  const eq = rust.indexOf('=', at + decl.length);
  const end = rust.indexOf(';', eq);
  expect(eq, `${name} has no assignment`).to.not.equal(-1);
  expect(end, `${name} has no terminator`).to.not.equal(-1);
  return rust.slice(eq + 1, end).trim();
}

/**
 * A scalar constant, evaluated for the only two shapes this file uses: a
 * literal, or a product of literals (`12 * 60 * 60`).
 */
function rustScalar(name: string): bigint {
  return rustRhs(name)
    .split('*')
    .map((part) => num(part.trim()))
    .reduce((a, b) => a * b, 1n);
}

/** A `pub const NAME: [T; N] = [ ... ];` array of integer literals. */
function rustArray(name: string): bigint[] {
  const rhs = rustRhs(name);
  const open = rhs.indexOf('[');
  const close = rhs.lastIndexOf(']');
  expect(open, `${name} is not an array literal`).to.not.equal(-1);
  return rhs
    .slice(open + 1, close)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(num);
}

describe('the TS mirror of programs/blotto_cup/src/constants.rs', () => {
  it('CAPACITY', () => expect(rustScalar('CAPACITY')).to.equal(CAPACITY));

  it('MIN_SEATS — the minimum field (D-E4)', () =>
    expect(rustScalar('MIN_SEATS')).to.equal(MIN_SEATS));

  it('DEFAULT_FILL_DEADLINE_SECS — 12 hours (D-E6)', () =>
    expect(rustScalar('DEFAULT_FILL_DEADLINE_SECS')).to.equal(DEFAULT_FILL_DEADLINE_SECS));

  it('DEFAULT_COOLDOWN_SECS', () =>
    expect(rustScalar('DEFAULT_COOLDOWN_SECS')).to.equal(DEFAULT_COOLDOWN_SECS));

  it('LIVENESS_FALLBACK_SECS — the keeper fallback', () =>
    expect(rustScalar('LIVENESS_FALLBACK_SECS')).to.equal(LIVENESS_FALLBACK_SECS));

  it('ESCROW_AUTO_RELEASE_SECS — the safeguard, never the published rule', () =>
    expect(rustScalar('ESCROW_AUTO_RELEASE_SECS')).to.equal(ESCROW_AUTO_RELEASE_SECS));

  it('PAID_RANKS — one paid place (D-E2)', () =>
    expect(Number(rustScalar('PAID_RANKS'))).to.equal(PAID_RANKS));

  it('TIER_ENTRY_LAMPORTS — the seven entry prices', () =>
    expect(rustArray('TIER_ENTRY_LAMPORTS')).to.deep.equal([...TIER_ENTRY_LAMPORTS]));

  it('TIER_POT_LAMPORTS — the seven fixed pots (D-E1)', () =>
    expect(rustArray('TIER_POT_LAMPORTS')).to.deep.equal([...TIER_POT_LAMPORTS]));

  it('PRIZE_BANDS_1024', () =>
    expect(rustArray('PRIZE_BANDS_1024')).to.deep.equal([...PRIZE_BANDS_1024]));

  it('the pot table still clears the minimum field at every tier', () => {
    // `MIN_SEATS × price > pot` is what makes a 52-seat pool profitable
    // rather than a loss the operator absorbs. `set_tier_economics` enforces
    // it on the LIVE values; this pins the LAUNCH table the rules page shows.
    TIER_ENTRY_LAMPORTS.forEach((price, tier) => {
      const minimumIntake = MIN_SEATS * price;
      const pot = TIER_POT_LAMPORTS[tier];
      expect(
        minimumIntake > pot,
        `tier ${tier}: ${minimumIntake} lamports at the minimum field must exceed the ${pot} pot`
      ).to.equal(true);
    });
  });
});
