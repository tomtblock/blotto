/*
 * NOTE FOR WHOEVER TOUCHES THE IMPORTS BELOW (2026-09-12).
 *
 * This file imports `backend/class-digest` directly, on purpose: the page it
 * covers cites that module as the published proof of the class draw, and a
 * test that only checks the file exists proves nothing about the claim.
 *
 * The consequence is a build-time coupling that is easy to miss. `next build`
 * type-checks this file, so the hosting provider's install step has to install
 * that package too — its own `installCommand` in `app/vercel.json` lists every
 * backend package the app reaches, and adding an import to a package that is
 * NOT on that list turns a green local build into a failed deploy with a
 * `Cannot find module` from inside `backend/`. That is exactly how it failed
 * the first time this test was wired up.
 */
/*
 * The Fair play page cannot show a number the study did not produce.
 *
 * Four bindings: the JSON the page imports is exactly the study's CSV
 * re-shaped (so the nightly reproduction of the CSV covers the page); the
 * table is built from the "mixed" rows at both ratified field sizes; the
 * class-draw replay the page claims is RUN here against the committed
 * cross-language vectors; and every other mechanism the page describes
 * points at the file that implements it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import evidence from '@docs/skill-evidence/results.json';
import { COPY } from '@/copy';
import {
  CLASS_NAMES,
  LAUNCH_CLASS_COUNTERS,
  deriveClassRandomness,
  weightedClassDraw,
} from '../../../../backend/class-digest/src';
import { FULL_FIELD, MIN_FIELD, SKILL_CLASSES, skillTable } from './fair-play.config';

const REPO = join(__dirname, '..', '..', '..', '..');

/** The same re-shaping the study runner performs, independently written. */
function csvRows(csv: string): Record<string, string>[] {
  const [head, ...lines] = csv.trim().split('\n');
  const cols = head.split(',');
  return lines.map((l) => Object.fromEntries(cols.map((c, i) => [c, l.split(',')[i]])));
}

describe('the skill evidence the page shows', () => {
  it('is the committed CSV, exactly', () => {
    const csv = readFileSync(join(REPO, 'docs/skill-evidence/results.csv'), 'utf8');
    expect(evidence.rows).toEqual(csvRows(csv));
    expect(evidence.columns).toEqual(csv.trim().split('\n')[0].split(','));
  });

  it('covers both ratified field sizes for every class, from the mixed run', () => {
    const table = skillTable();
    expect(table.map((r) => r.cls)).toEqual([...SKILL_CLASSES]);
    for (const row of table) {
      const full = evidence.rows.find(
        (r) => r.run === 'mixed' && r.class === row.cls && Number(r.seats) === FULL_FIELD,
      );
      const min = evidence.rows.find(
        (r) => r.run === 'mixed' && r.class === row.cls && Number(r.seats) === MIN_FIELD,
      );
      expect(row.fullPct).toBe(full?.rank1_rate_pct);
      expect(row.minPct).toBe(min?.rank1_rate_pct);
      expect(row.label).toBe(COPY.fairPlay.skillRows[row.cls]);
    }
  });

  it('says the default player never placed first only while that is what the study shows', () => {
    // The copy states "never"; if a future engine change lets an even split
    // win, the sentence must change with it, not outlive it.
    const uniform = skillTable().find((r) => r.cls === 'uniform');
    expect(uniform?.fullPct).toBe('0.000');
    expect(uniform?.minPct).toBe('0.000');
    expect(COPY.fairPlay.skillIntro).toContain('never placed first');
  });
});

/*
 * THE CLASS-DRAW CLAIM, EXERCISED (audit 2026-09-11, F-18).
 *
 * The page renders COPY.rules.randomness, which ends "Every class draw is
 * replayable from published on-chain data." Until now the only thing
 * standing behind that sentence in this suite was `existsSync` on
 * backend/class-digest/src/digest.ts — a check that passes for an empty
 * file. These cases import the module the page's proof list cites and RUN
 * the replay over `crates/blotto-randomness/fixtures/vectors.json`: digests
 * and draw outcomes computed by Python, not by either implementation of
 * ours, and the same file the Rust crate's own suite is pinned to.
 *
 * WHAT THIS PROVES: the replay exists, resolves from this app's build, and
 * reproduces the committed vectors byte for byte — so the TypeScript the
 * page points a player at agrees with the program that actually draws.
 *
 * WHAT IT DOES NOT PROVE, said plainly: that a player can perform the replay
 * through this product. The verify page does not run this module (see its
 * own header in backend/class-digest/src/index.ts), so "replayable" today
 * means a player must feed the published events — `PoolVrfSeeded.vrf_seed`
 * and each `EntryRegistered`'s index, slot hash, pool and player — into the
 * replay themselves. Nothing here reads a published event, and no test in
 * this suite does. Wiring the verify page is the outstanding work; when it
 * lands, the case to add is one that replays a real bundle's draws.
 */
describe('the class-draw replay the page cites', () => {
  const vectors = JSON.parse(
    readFileSync(join(REPO, 'crates/blotto-randomness/fixtures/vectors.json'), 'utf8'),
  ) as {
    class_names: string[];
    class_counters: number[];
    capacity: number;
    derive: Array<{
      name: string;
      vrf_seed: string;
      slot_hash: string;
      entry_index: number;
      pool_pubkey: string;
      player_pubkey: string;
      expected: string;
    }>;
    draw: Array<{ name: string; rng_bytes: string; expected_index: number; expected_class: string }>;
  };

  const unhex = (h: string) => Uint8Array.from(Buffer.from(h, 'hex'));
  const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

  it('draws from the same bag the program does', () => {
    expect([...LAUNCH_CLASS_COUNTERS]).toEqual(vectors.class_counters);
    expect([...CLASS_NAMES]).toEqual(vectors.class_names);
    expect(LAUNCH_CLASS_COUNTERS.reduce((a, b) => a + b, 0)).toBe(vectors.capacity);
  });

  it('reproduces every committed digest vector', () => {
    expect(vectors.derive.length).toBeGreaterThan(0);
    for (const v of vectors.derive) {
      const got = deriveClassRandomness(
        unhex(v.vrf_seed),
        unhex(v.slot_hash),
        v.entry_index,
        unhex(v.pool_pubkey),
        unhex(v.player_pubkey),
      );
      expect(hex(got), v.name).toBe(v.expected);
    }
  });

  it('reproduces every committed draw vector, class name included', () => {
    expect(vectors.draw.length).toBeGreaterThan(0);
    for (const v of vectors.draw) {
      const idx = weightedClassDraw(unhex(v.rng_bytes), vectors.class_counters);
      expect(idx, v.name).toBe(v.expected_index);
      expect(CLASS_NAMES[idx], v.name).toBe(v.expected_class);
    }
  });

  it('refuses an empty bag rather than returning a class', () => {
    expect(() => weightedClassDraw(new Uint8Array(32), [0, 0, 0, 0, 0])).toThrow('empty bag');
  });
});

/*
 * The remaining mechanisms are still file-existence checks, and that is all
 * they claim to be: each one proves the page is not citing a path that has
 * been renamed or deleted, and nothing more. They are not evidence that the
 * mechanism works — the suites that own each file are.
 */
describe('every other mechanism the page describes has its file where the page says', () => {
  const proofs: Array<[string, string]> = [
    ['entry screening', 'backend/packet/src/sanctions-wiring.ts'],
    ['winner screening', 'backend/reveal/src/winner-screening.ts'],
    ['the study', 'tests/rehearsal/src/skill-evidence.ts'],
    ['the study output', 'docs/skill-evidence/results.csv'],
    ['the age attestation', 'app/src/entry/attestation.ts'],
    ['the territory gate', 'app/src/entry/geo-gate.ts'],
  ];
  for (const [what, file] of proofs) {
    it(`${what}: ${file}`, () => {
      expect(existsSync(join(REPO, file))).toBe(true);
    });
  }
});
