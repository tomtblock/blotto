/**
 * CLI entry for the skill-evidence study (D-A2): runs the study and writes
 * `docs/skill-evidence/REPORT.md` + `docs/skill-evidence/results.csv` at the
 * repository root. Parameters via env so CI and local runs stay identical:
 *
 *   SKILL_EVIDENCE_POOLS  (default 200 — the ratified floor)
 *   SKILL_EVIDENCE_SEED   (default 20260827)
 *   SKILL_EVIDENCE_CHECK  (set to 1: do not write; fail if the committed
 *                          files differ from a fresh run — the nightly job)
 */

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runSkillEvidence } from './skill-evidence';
import { renderJson } from './skill-evidence-json';

async function main(): Promise<void> {
  const pools = Number(process.env.SKILL_EVIDENCE_POOLS ?? 200);
  const baseSeed = Number(process.env.SKILL_EVIDENCE_SEED ?? 20260827);
  const check = process.env.SKILL_EVIDENCE_CHECK === '1';

  const started = Date.now();
  const result = await runSkillEvidence({ pools, baseSeed });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  const dir = join(__dirname, '..', '..', '..', 'docs', 'skill-evidence');
  const csvPath = join(dir, 'results.csv');
  const reportPath = join(dir, 'REPORT.md');
  // The same rows as JSON, for the app's Fair play page (a JSON import).
  const jsonPath = join(dir, 'results.json');
  const json = renderJson(result.csv);

  if (check) {
    const committedCsv = readFileSync(csvPath, 'utf8');
    const committedReport = readFileSync(reportPath, 'utf8');
    const committedJson = readFileSync(jsonPath, 'utf8');
    if (committedCsv !== result.csv || committedReport !== result.report || committedJson !== json) {
      console.error(
        'skill-evidence drift: a fresh run differs from the committed artifacts.\n' +
          'The scoring or settlement path changed outcomes — regenerate with\n' +
          '`npm run skill-evidence` and commit the diff with the change that caused it.'
      );
      process.exit(1);
    }
    console.log(`skill-evidence check: ${pools} pools reproduce the committed artifacts (${elapsed}s)`);
    return;
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(csvPath, result.csv);
  writeFileSync(reportPath, result.report);
  writeFileSync(jsonPath, json);
  console.log(`wrote ${csvPath}, ${reportPath} and ${jsonPath} (${pools} pools, ${elapsed}s)`);
  for (const line of result.csv.trim().split('\n')) console.log('  ' + line);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
