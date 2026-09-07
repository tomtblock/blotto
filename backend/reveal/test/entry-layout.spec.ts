/**
 * The Entry account's byte length, pinned across the language boundary.
 *
 * `chain-web3.ts` filters `getProgramAccounts` on `dataSize: ENTRY_SPACE`. A
 * wrong number there does not throw and does not fail a type check — the
 * filter simply matches nothing, `getEntries` returns `[]`, and the crank
 * concludes a full pool has no entrants. That is precisely what had happened:
 * the constant read 208 while the program had been 227 since the split fields
 * landed on 2026-09-07. Every suite drives `FakeChain`, and devnet has not
 * settled a real pool, so nothing noticed.
 *
 * This is the durable fix — the same discipline `backend/scoring`'s
 * `mirror.spec.ts` applies to the prize constants: read the Rust, compare.
 */
import { expect } from 'chai';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ENTRY_SPACE } from '../src/chain-web3';

const STATE_RS = join(__dirname, '../../../programs/blotto_cup/src/state.rs');
const rust = readFileSync(STATE_RS, 'utf8');

/** The value `state.rs`'s own layout test pins for `Entry::SPACE`. */
function pinnedEntrySpace(): number {
  const marker = 'assert_eq!(Entry::SPACE,';
  const at = rust.indexOf(marker);
  expect(at, 'state.rs no longer pins Entry::SPACE').to.not.equal(-1);
  const end = rust.indexOf(')', at + marker.length);
  return Number(rust.slice(at + marker.length, end).trim());
}

describe('the Entry account layout, across the language boundary', () => {
  it('ENTRY_SPACE equals the program`s Entry::SPACE', () => {
    expect(ENTRY_SPACE).to.equal(pinnedEntrySpace());
  });

  it('state.rs still derives that length from its own field tally', () => {
    // If the struct grows and only the assertion is edited, the tally below
    // diverges and this fails — the assertion cannot silently absorb a field.
    const lenV1 = 32 + 32 + 2 + 32 + 1 + 32 + 8 + 32 + 1 + 1 + 1 + 8 + 1; // 183
    const tail = 8 + 1 + 8 + 8 + 8 + 2 + 1 + 1; // through sanctions_hold
    expect(8 + lenV1 + tail).to.equal(pinnedEntrySpace());
  });
});
