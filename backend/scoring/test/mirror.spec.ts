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
  DEFAULT_COOLDOWN_SECS,
  DEFAULT_FILL_DEADLINE_SECS,
  ESCROW_AUTO_RELEASE_SECS,
  LADDER_TABLES,
  MAX_CAPACITY,
  MAX_PAID_PLACES,
  MIN_FIELD_BY_CAPACITY,
  POOL_CAPACITIES,
  TIER_ENTRY_LAMPORTS,
  prizePoolFor,
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

/** A `pub const NAME: [[T; N]; M] = [[...], [...]];` table of integer literals. */
function rustTable(name: string): bigint[][] {
  const rhs = rustRhs(name);
  const rows: bigint[][] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < rhs.length; i++) {
    if (rhs[i] === '[') {
      depth++;
      if (depth === 2) start = i + 1;
    } else if (rhs[i] === ']') {
      if (depth === 2) {
        rows.push(
          rhs
            .slice(start, i)
            .split(',')
            .map((x) => x.trim())
            .filter((x) => x.length > 0)
            .map(num)
        );
      }
      depth--;
    }
  }
  return rows;
}

describe('the TS mirror of programs/blotto_cup/src/constants.rs', () => {
  it('CAPACITY — the largest pool (MAX_CAPACITY here)', () =>
    expect(rustScalar('CAPACITY')).to.equal(MAX_CAPACITY));

  it('POOL_CAPACITIES — the four sizes (D-E19)', () =>
    expect(rustArray('POOL_CAPACITIES')).to.deep.equal(POOL_CAPACITIES.map(BigInt)));

  it('MAX_PAID_PLACES', () =>
    expect(Number(rustScalar('MAX_PAID_PLACES'))).to.equal(MAX_PAID_PLACES));

  it('LADDER_TABLES — every table, zero-padded on the Rust side (D-E19)', () => {
    const rows = rustTable('LADDER_TABLES');
    expect(rows.length).to.equal(POOL_CAPACITIES.length);
    POOL_CAPACITIES.forEach((cap, k) => {
      const ts = LADDER_TABLES[cap].map(BigInt);
      const padded = [...ts, ...Array(MAX_PAID_PLACES - ts.length).fill(0n)];
      expect(rows[k], `table for ${cap}`).to.deep.equal(padded);
    });
  });

  it('LADDER_MIN_SEATS — the minimum field per size (D-E19)', () =>
    expect(rustArray('LADDER_MIN_SEATS')).to.deep.equal(
      POOL_CAPACITIES.map((c) => BigInt(MIN_FIELD_BY_CAPACITY[c]))
    ));

  it('the retired single-table constants are gone from BOTH sides', () => {
    // D-E19 retired D-E2's one paid place and its 1024ths grid. Pinned as an
    // absence, because a constant that comes back on one side only is
    // exactly the drift this suite exists to catch.
    for (const gone of ['PAID_RANKS', 'PRIZE_BANDS_1024', 'MIN_SEATS:']) {
      expect(rust.includes(`pub const ${gone}`), gone).to.equal(false);
    }
  });

  it('DEFAULT_FILL_DEADLINE_SECS — 12 hours (D-E6)', () =>
    expect(rustScalar('DEFAULT_FILL_DEADLINE_SECS')).to.equal(DEFAULT_FILL_DEADLINE_SECS));

  it('DEFAULT_COOLDOWN_SECS', () =>
    expect(rustScalar('DEFAULT_COOLDOWN_SECS')).to.equal(DEFAULT_COOLDOWN_SECS));

  it('the keeper liveness fallback is gone from BOTH sides (audit O9b)', () => {
    // Removed 2026-09-07: `open_pool` is keeper-only. Pinned as an absence,
    // because a constant that comes back on one side only is exactly the
    // drift this suite exists to catch.
    expect(rust.includes('pub const LIVENESS_FALLBACK_SECS')).to.equal(false);
  });

  it('ESCROW_AUTO_RELEASE_SECS — the safeguard, never the published rule', () =>
    expect(rustScalar('ESCROW_AUTO_RELEASE_SECS')).to.equal(ESCROW_AUTO_RELEASE_SECS));

  it('TIER_ENTRY_LAMPORTS — the seven entry prices', () =>
    expect(rustArray('TIER_ENTRY_LAMPORTS')).to.deep.equal([...TIER_ENTRY_LAMPORTS]));

  it('TIER_POT_LAMPORTS is the 64-player prize pool at every tier', () => {
    // Since D-E19 no pool is funded from the tier pot; it is the reference
    // figure Config carries. It must still be the 64 table at the price —
    // the spec's "the 64 column is today's published prize pool".
    const pots = rustArray('TIER_POT_LAMPORTS');
    TIER_ENTRY_LAMPORTS.forEach((price, tier) => {
      expect(pots[tier], `tier ${tier}`).to.equal(prizePoolFor(LADDER_TABLES[64], price));
    });
  });

  it('every prize pool is exactly its minimum field’s entries (break-even, at every size and tier)', () => {
    // R7-b's rule at 64 (founder ruling 2026-09-13), carried to every size by
    // D-E19: the minimum field IS break-even. `set_pool_type_economics`
    // enforces `pot <= min_seats × price` on the live values; this pins the
    // LAUNCH tables as an EQUALITY — a drift in either direction is a change
    // to the published economics and should fail here.
    for (const cap of POOL_CAPACITIES) {
      TIER_ENTRY_LAMPORTS.forEach((price, tier) => {
        expect(
          BigInt(MIN_FIELD_BY_CAPACITY[cap]) * price,
          `${cap} players, tier ${tier}`
        ).to.equal(prizePoolFor(LADDER_TABLES[cap], price));
      });
    }
  });
});
