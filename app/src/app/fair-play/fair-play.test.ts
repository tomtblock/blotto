/*
 * The Fair play page cannot show a number the study did not produce.
 *
 * Three bindings: the JSON the page imports is exactly the study's CSV
 * re-shaped (so the nightly reproduction of the CSV covers the page); the
 * table is built from the "mixed" rows at both ratified field sizes; and
 * every mechanism the page describes points at the file that implements it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import evidence from '@docs/skill-evidence/results.json';
import { COPY } from '@/copy';
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

describe('every mechanism the page describes exists', () => {
  const proofs: Array<[string, string]> = [
    ['entry screening', 'backend/packet/src/sanctions-wiring.ts'],
    ['winner screening', 'backend/reveal/src/winner-screening.ts'],
    ['the study', 'tests/rehearsal/src/skill-evidence.ts'],
    ['the study output', 'docs/skill-evidence/results.csv'],
    ['the age attestation', 'app/src/entry/attestation.ts'],
    ['the territory gate', 'app/src/entry/geo-gate.ts'],
    ['the class draw replay', 'backend/class-digest/src/digest.ts'],
  ];
  for (const [what, file] of proofs) {
    it(`${what}: ${file}`, () => {
      expect(existsSync(join(REPO, file))).toBe(true);
    });
  }
});
