/**
 * The class digest + bag draw pinned to the SAME Python vectors as the Rust
 * crate (roadmap 2.2): `crates/blotto-randomness/fixtures/vectors.json`.
 * Rust, TypeScript and the oracle can only move together.
 */
import { expect } from 'chai';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CLASS_NAMES,
  LAUNCH_CLASS_COUNTERS,
  deriveClassRandomness,
  weightedClassDraw,
} from '../src';

const vectors = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', 'crates', 'blotto-randomness', 'fixtures', 'vectors.json'),
    'utf8'
  )
);

const unhex = (s: string) => new Uint8Array(Buffer.from(s, 'hex'));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('class digest (pinned to the blotto-randomness vectors)', () => {
  it('shares the crate constants', () => {
    expect([...LAUNCH_CLASS_COUNTERS]).to.deep.equal(vectors.class_counters);
    expect([...CLASS_NAMES]).to.deep.equal(vectors.class_names);
    expect(LAUNCH_CLASS_COUNTERS.reduce((a, b) => a + b, 0)).to.equal(vectors.capacity);
  });
  for (const v of vectors.derive) {
    it(`derive: ${v.name}`, () => {
      const got = deriveClassRandomness(
        unhex(v.vrf_seed),
        unhex(v.slot_hash),
        v.entry_index,
        unhex(v.pool_pubkey),
        unhex(v.player_pubkey)
      );
      expect(hex(got)).to.equal(v.expected);
    });
  }
  for (const v of vectors.draw) {
    it(`draw: ${v.name}`, () => {
      const idx = weightedClassDraw(unhex(v.rng_bytes), vectors.class_counters);
      expect(idx).to.equal(v.expected_index);
      expect(CLASS_NAMES[idx]).to.equal(v.expected_class);
    });
  }
  it('refuses an empty bag', () => {
    expect(() => weightedClassDraw(new Uint8Array(32), [0, 0, 0, 0, 0])).to.throw('empty bag');
  });
});
