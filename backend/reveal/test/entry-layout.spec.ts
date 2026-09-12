/**
 * The Entry account's byte layout, pinned across the language boundary.
 *
 * `chain-web3.ts` filters `getProgramAccounts` on `dataSize: ENTRY_SPACE` and
 * reads every field by a hard-coded byte offset (`ENTRY_LAYOUT`). Neither a
 * wrong size nor a wrong offset throws and neither fails a type check — the
 * filter simply matches nothing, or a neighbouring field is read as if it
 * were the one asked for. That is precisely what had happened with the size:
 * the constant read 208 while the program had been 227 since the split
 * fields landed on 2026-09-07, so `getEntries` returned `[]` and the crank
 * would have concluded a full pool had no entrants. Every suite drives
 * `FakeChain`, and devnet has not settled a real pool, so nothing noticed.
 *
 * The offsets matter for the same reason since audit D-11: the next-place
 * driver resumes a part-paid split from the split frame it reads at
 * offsets 200..226, and a frame read one field off would make it argue a
 * split the program refuses — or worse, one it accepts.
 *
 * This is the durable fix — the same discipline `backend/scoring`'s
 * `mirror.spec.ts` applies to the prize constants: read the Rust, compare.
 */
import { expect } from 'chai';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ENTRY_LAYOUT, ENTRY_SPACE, clockUnixTimestamp } from '../src/chain-web3';

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

/** Borsh widths of the field types `Entry` declares — fixed-width, no
 * padding, declaration order. A type missing here fails the offset test by
 * name rather than being guessed. */
const WIDTH: Record<string, number> = {
  Pubkey: 32,
  '[u8; 32]': 32,
  u64: 8,
  i64: 8,
  u16: 2,
  u8: 1,
  bool: 1,
};

/** `Entry`'s fields in declaration order, parsed from `state.rs`. */
function entryFields(): { name: string; type: string }[] {
  const start = rust.indexOf('pub struct Entry {');
  expect(start, 'state.rs no longer declares `pub struct Entry`').to.not.equal(-1);
  const end = rust.indexOf('\n}', start);
  const body = rust.slice(start, end);
  const fields: { name: string; type: string }[] = [];
  for (const m of body.matchAll(/^\s*pub (\w+): ([^,]+),/gm)) {
    fields.push({ name: m[1], type: m[2].trim() });
  }
  return fields;
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

describe('the Entry field offsets, across the language boundary', () => {
  const fields = entryFields();

  it('parsed the struct in declaration order', () => {
    expect(fields[0]?.name).to.equal('pool');
    expect(fields[fields.length - 1]?.name).to.equal('sanctions_hold');
    expect(fields.length, 'Entry has more fields than this parse found').to.be.greaterThan(15);
  });

  it('every offset the client reads is the running sum of the fields declared before it', () => {
    let offset = 8; // the Anchor discriminator
    const derived: Record<string, number> = {};
    for (const f of fields) {
      const width = WIDTH[f.type];
      expect(width, `no Borsh width for Entry.${f.name}: ${f.type}`).to.not.equal(undefined);
      derived[f.name] = offset;
      offset += width;
    }
    expect(offset, 'the field tally reaches Entry::SPACE').to.equal(pinnedEntrySpace());
    for (const [name, at] of Object.entries(ENTRY_LAYOUT)) {
      expect(derived[name], `ENTRY_LAYOUT.${name} is not a field of Entry`).to.not.equal(undefined);
      expect(at, `ENTRY_LAYOUT.${name}`).to.equal(derived[name]);
    }
  });

  it('the split frame is read from where the program writes it (audit D-11)', () => {
    // Spelled out, so a change to these numbers is a reviewed act: the
    // next-place driver resumes a part-paid split from exactly these bytes.
    expect(ENTRY_LAYOUT.next_place_lamports).to.equal(200);
    expect(ENTRY_LAYOUT.split_total).to.equal(208);
    expect(ENTRY_LAYOUT.split_paid_mask).to.equal(216);
    expect(ENTRY_LAYOUT.split_group_size).to.equal(224);
    expect(ENTRY_LAYOUT.split_remainder_paid).to.equal(226);
    expect(ENTRY_LAYOUT.sanctions_hold).to.equal(227);
  });
});

describe('the Clock sysvar layout the daemon reads (`chainNow`)', () => {
  /** A bincode-encoded `Clock`, every field distinct so a wrong offset
   * returns a recognisably wrong value rather than a coincidence. */
  function clock(unixTimestamp: bigint): Buffer {
    const buf = Buffer.alloc(40);
    buf.writeBigUInt64LE(497_261_524n, 0); // slot
    buf.writeBigInt64LE(1_757_600_000n, 8); // epoch_start_timestamp
    buf.writeBigUInt64LE(842n, 16); // epoch
    buf.writeBigUInt64LE(843n, 24); // leader_schedule_epoch
    buf.writeBigInt64LE(unixTimestamp, 32); // unix_timestamp
    return buf;
  }

  it('unix_timestamp is the i64 at byte 32', () => {
    expect(clockUnixTimestamp(clock(1_757_664_000n))).to.equal(1_757_664_000n);
    // Signed and wider than 32 bits: an i64 read, not a u32 one.
    expect(clockUnixTimestamp(clock(-5n))).to.equal(-5n);
    expect(clockUnixTimestamp(clock(1n << 40n))).to.equal(1n << 40n);
  });

  it('refuses an account shorter than the layout', () => {
    expect(() => clockUnixTimestamp(Buffer.alloc(39))).to.throw(/40/);
  });
});
