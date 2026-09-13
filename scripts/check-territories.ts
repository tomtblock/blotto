/**
 * The territory-schedule gate (founder instruction 2026-09-12 §3.1).
 *
 * `config/territories.json` is founder-owned and decides who may enter. Four
 * things can go wrong with it quietly, and this refuses the build on each:
 *
 *   1. THE FILE DOES NOT PARSE. Checked with the REAL loader —
 *      `parseTerritorySchedule` from backend/packet — never a second
 *      implementation. A checker with its own parser tests the checker.
 *
 *   2. A CODE HAS NO DISPLAY NAME, so a blocked player is told they are
 *      blocked by a page reading "SG". The name map is
 *      app/src/rules/territoryNames.ts.
 *
 *   3. THE LEGEND AND THE FILE DISAGREE. `config/territories.README.md`
 *      carries one row per live code with the PID §9 line it implements;
 *      a code in one and not the other, either direction, means somebody
 *      edited a list without recording why.
 *
 *   4. A SUB-NATIONAL RULE THAT NOTHING CAN ENFORCE. This is the one that
 *      matters. The entry service refuses to START when the schedule blocks
 *      a `CC-SSS` code and the configured lookup cannot resolve a region
 *      (`assertRegionCapability`, backend/packet/src/service.ts) — correctly,
 *      because such a rule admits every person it names. But that failure
 *      arrives at deploy, on a service that then will not come up. Here it
 *      arrives on the change that added the code.
 *
 * Run: npx tsx scripts/check-territories.ts [--self-test]
 * Exit: 0 clean · 1 the tree is wrong · 2 this gate is broken.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseTerritorySchedule, type TerritorySchedule } from '../backend/packet/src/territories';
import { namedTerritoryCodes } from '../app/src/rules/territoryNames';

const ROOT = resolve(__dirname, '..');

/** Codes listed in the README's "Live" table, which is the legend for what
 * the schedule carries. Held codes live under later headings and are
 * deliberately NOT collected: they are documented precisely because they are
 * absent from the file. */
export function liveCodesFromReadme(markdown: string): string[] {
  const start = markdown.indexOf('\n## Live');
  if (start === -1) throw new Error('territories.README.md: no "## Live" section');
  const rest = markdown.slice(start + 1);
  const end = rest.indexOf('\n## ');
  const section = end === -1 ? rest : rest.slice(0, end);
  const codes = new Set<string>();
  for (const line of section.split('\n')) {
    // Table rows only: `| `XX` | Name | … |`. The leading pipe keeps prose
    // that happens to quote a code out of the legend.
    if (!line.startsWith('|')) continue;
    const m = /^\|\s*`([A-Z]{2}(?:-[A-Z0-9]{1,3})?)`\s*\|/.exec(line);
    if (m) codes.add(m[1]);
  }
  return [...codes].sort();
}

/** Does any geo adapter in the tree declare that it resolves ISO 3166-2
 * regions? Mirrors `assertRegionCapability`'s precondition at build time.
 * Read from the source rather than from a list here, so that adding a
 * capable adapter is all it takes to unblock the sub-national rules. */
export function someAdapterResolvesRegion(sources: readonly string[]): boolean {
  return sources.some((src) => /readonly\s+resolvesRegion\s*=\s*true/.test(src));
}

export function checkSchedule(opts: {
  scheduleJson: string;
  readme: string;
  namedCodes: readonly string[];
  geoSources: readonly string[];
}): string[] {
  const failures: string[] = [];

  let schedule: TerritorySchedule;
  try {
    schedule = parseTerritorySchedule(opts.scheduleJson);
  } catch (e) {
    // Nothing below is meaningful without a parsed schedule.
    return [`territories(1) FAILED: ${e instanceof Error ? e.message : String(e)}`];
  }

  const codes = [...schedule.allowed, ...schedule.blocked];

  // (1b) Alphabetised, so a diff to this file reads as what changed.
  const sortedBlocked = [...schedule.blocked].sort();
  if (schedule.blocked.join(',') !== sortedBlocked.join(',')) {
    failures.push(
      `territories(1) FAILED: blocked is not alphabetised — expected ${sortedBlocked.join(', ')}`
    );
  }

  // (2) Every code renders as a name.
  const named = new Set(opts.namedCodes);
  for (const code of codes) {
    if (!named.has(code)) {
      failures.push(
        `territories(2) FAILED: ${code} has no display name — add it to ` +
          `app/src/rules/territoryNames.ts, or a blocked player is shown the bare code`
      );
    }
  }

  // (3) The legend and the file agree, both directions.
  let documented: string[];
  try {
    documented = liveCodesFromReadme(opts.readme);
  } catch (e) {
    return [...failures, `territories(3) FAILED: ${e instanceof Error ? e.message : String(e)}`];
  }
  const inReadme = new Set(documented);
  for (const code of codes) {
    if (!inReadme.has(code)) {
      failures.push(
        `territories(3) FAILED: ${code} is in the schedule but has no row in the Live table of ` +
          `config/territories.README.md — every code records the PID §9 line it implements`
      );
    }
  }
  const inSchedule = new Set(codes);
  for (const code of documented) {
    if (!inSchedule.has(code)) {
      failures.push(
        `territories(3) FAILED: ${code} is in the Live table of config/territories.README.md but ` +
          `not in the schedule — move it to a Held section, or add it to the schedule`
      );
    }
  }

  // (4) A sub-national rule needs a lookup that can resolve a region.
  const subNational = schedule.blocked.filter((c) => c.includes('-'));
  if (subNational.length > 0 && !someAdapterResolvesRegion(opts.geoSources)) {
    failures.push(
      `territories(4) FAILED: the schedule blocks ${subNational.join(', ')}, which is a ` +
        `sub-national rule, and no geo adapter in this tree declares resolvesRegion = true. ` +
        `The entry service would refuse to start (assertRegionCapability), and before that ` +
        `check existed those entries admitted every person they named. Add a region-capable ` +
        `source to the composite, or keep these codes in a Held section of ` +
        `config/territories.README.md.`
    );
  }

  return failures;
}

// ---------------------------------------------------------------------------
// The gate tests itself. A rule that does not fire on a deliberate violation
// is not enforcing anything — the same standard as check-standing-rules.sh.
// ---------------------------------------------------------------------------

const GOOD_README = `
# legend

## Live — version 3

| Code | Territory | PID §9 line | Status |
|---|---|---|---|
| \`BE\` | Belgium | "Blocked: … Belgium" | Confirmed |
| \`IN\` | India | "Blocked: India" | Confirmed |

## Held

| \`US-WA\` | Washington | held | pending |
`;

function selfTest(): boolean {
  const ok = (name: string, cond: boolean) => {
    if (!cond) console.error(`self-test FAILED: ${name}`);
    return cond;
  };
  const base = {
    readme: GOOD_README,
    namedCodes: ['BE', 'IN', 'US-WA'],
    geoSources: ['readonly resolvesRegion = false;'],
  };
  const good = JSON.stringify({
    version: 3,
    posture: 'block-list',
    allowed: [],
    blocked: ['BE', 'IN'],
    updated: '2026-09-12',
  });

  let pass = true;
  pass = ok('a clean schedule passes', checkSchedule({ ...base, scheduleJson: good }).length === 0) && pass;
  pass =
    ok(
      'malformed JSON fails',
      checkSchedule({ ...base, scheduleJson: '{' })[0]?.includes('territories(1)') === true
    ) && pass;
  pass =
    ok(
      'an out-of-order list fails',
      checkSchedule({
        ...base,
        scheduleJson: good.replace('["BE","IN"]', '["IN","BE"]'),
      }).some((f) => f.includes('alphabetised'))
    ) && pass;
  pass =
    ok(
      'an unnamed code fails',
      checkSchedule({ ...base, namedCodes: ['BE'], scheduleJson: good }).some((f) =>
        f.includes('territories(2)')
      )
    ) && pass;
  pass =
    ok(
      'a code missing from the legend fails',
      checkSchedule({
        ...base,
        namedCodes: ['BE', 'IN', 'SG', 'US-WA'],
        scheduleJson: good.replace('["BE","IN"]', '["BE","IN","SG"]'),
      }).some((f) => f.includes('territories(3)'))
    ) && pass;
  pass =
    ok(
      'a legend row with no code in the schedule fails',
      checkSchedule({ ...base, scheduleJson: good.replace('["BE","IN"]', '["BE"]') }).some((f) =>
        f.includes('territories(3)')
      )
    ) && pass;
  // (4) both ways round — this is the check the US states are held by.
  const withState = good.replace('["BE","IN"]', '["BE","IN","US-WA"]');
  pass =
    ok(
      'a sub-national code with no region-capable adapter fails',
      checkSchedule({
        ...base,
        readme: GOOD_README.replace('## Held', '| `US-WA` | Washington | live | Confirmed |\n\n## Held'),
        scheduleJson: withState,
      }).some((f) => f.includes('territories(4)'))
    ) && pass;
  pass =
    ok(
      'the same code passes once an adapter resolves regions',
      checkSchedule({
        ...base,
        readme: GOOD_README.replace('## Held', '| `US-WA` | Washington | live | Confirmed |\n\n## Held'),
        geoSources: ['readonly resolvesRegion = true;'],
        scheduleJson: withState,
      }).length === 0
    ) && pass;
  return pass;
}

function geoSources(): string[] {
  const dir = resolve(ROOT, 'backend', 'packet', 'src');
  // Every adapter that could be wired into the composite. Read as text
  // rather than imported: this runs in CI without the service's env.
  return ['geo-iplocate.ts', 'geo-adapters.ts', 'geo-composite.ts'].map((f) =>
    readFileSync(resolve(dir, f), 'utf8')
  );
}

function main(): void {
  if (!selfTest()) {
    console.error('territory gate: THE GATE ITSELF IS BROKEN — fix the check, never the probe.');
    process.exit(2);
  }
  const failures = checkSchedule({
    scheduleJson: readFileSync(resolve(ROOT, 'config', 'territories.json'), 'utf8'),
    readme: readFileSync(resolve(ROOT, 'config', 'territories.README.md'), 'utf8'),
    namedCodes: namedTerritoryCodes(),
    geoSources: geoSources(),
  });
  if (failures.length > 0) {
    console.error('territory gate: FAILED\n');
    for (const f of failures) console.error(`  ${f}`);
    console.error('\nconfig/territories.json is founder-owned: fix the tree to match it, and');
    console.error('change the lists themselves only on a founder instruction.');
    process.exit(1);
  }
  console.log('territory schedule: clean (self-test passed)');
}

if (require.main === module) main();
