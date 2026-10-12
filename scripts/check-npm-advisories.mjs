#!/usr/bin/env node
/*
 * The npm half of the advisory gate (scanner triage 2026-10-11, item G).
 *
 * security-sweep.yml's npm job used to REPORT and never fail, for a reason its
 * header gave: the tree carried high advisories with no fix available, and a
 * lane that is red the day it lands is a lane people learn to skip. The remedy
 * it named was a committed baseline of advisory ids, each with its
 * reachability finding written next to it, and a gate that fails on anything
 * NOT in it. This is that gate. It would have caught next 16.3.0's critical
 * advisories the day they were published, instead of a scanner a month later.
 *
 * For each package directory: run `npm audit --json` against the lockfile
 * (dev dependencies included — the service images install them, see
 * deploy/docker/Dockerfile.*), collect every advisory at HIGH or CRITICAL by
 * its GHSA id, and compare with scripts/npm-advisory-baseline.json.
 *
 *   - an advisory not in the baseline   -> error, exit 1;
 *   - a baseline entry no longer seen   -> warning (remove it), exit unchanged.
 *
 * Moderate and low advisories are not gated; the workflow prints them.
 *
 * Run from the repository root:  node scripts/check-npm-advisories.mjs [dir ...]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GATED = new Set(['high', 'critical']);

/** Every package directory with its own package-lock.json. */
export const PACKAGE_DIRS = [
  'app',
  'backend/_shared',
  'backend/scoring',
  'backend/class-digest',
  'backend/sealing',
  'backend/sanctions',
  'backend/reveal',
  'backend/indexer',
  'backend/packet',
  'backend/detection',
  'battle-test',
  'tests/postgres',
  'tests/rehearsal',
];

/** GHSA id -> "severity name range" for every gated advisory in one audit report. */
export function gatedAdvisories(report) {
  const found = new Map();
  for (const vuln of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      // A string `via` names another vulnerable package, not an advisory.
      if (typeof via !== 'object' || !GATED.has(via.severity)) continue;
      const id = String(via.url ?? '').split('/').pop();
      if (id) found.set(id, `${via.severity} ${via.name} ${via.range}`);
    }
  }
  return found;
}

function audit(dir) {
  try {
    return execFileSync('npm', ['audit', '--json'], {
      cwd: resolve(ROOT, dir),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // npm audit exits non-zero whenever it finds anything; the report is
    // still on stdout. Only a missing report is a real failure.
    if (error.stdout) return error.stdout;
    throw error;
  }
}

/**
 * The gate tests itself first, like the repository's other gates: a report
 * carrying one gated advisory, one moderate one and a package-to-package
 * `via` string must come back as exactly the gated id.
 */
function selfTest() {
  const probe = {
    vulnerabilities: {
      a: { via: [{ severity: 'critical', name: 'a', range: '<2', url: 'https://github.com/advisories/GHSA-test-crit-0001' }] },
      b: { via: ['a', { severity: 'moderate', name: 'b', range: '<1', url: 'https://github.com/advisories/GHSA-test-mod-0002' }] },
    },
  };
  const ids = [...gatedAdvisories(probe).keys()];
  if (ids.length !== 1 || ids[0] !== 'GHSA-test-crit-0001') {
    console.log(`::error::check-npm-advisories self-test failed: got ${JSON.stringify(ids)}`);
    process.exit(2);
  }
}

function main() {
  selfTest();
  const baseline = JSON.parse(readFileSync(resolve(ROOT, 'scripts/npm-advisory-baseline.json'), 'utf8'));
  const dirs = process.argv.length > 2 ? process.argv.slice(2) : PACKAGE_DIRS;
  let failed = false;
  for (const dir of dirs) {
    const known = baseline[dir] ?? {};
    let report;
    try {
      report = JSON.parse(audit(dir));
    } catch (error) {
      console.log(`::error::${dir}: npm audit produced no report (${error.message})`);
      failed = true;
      continue;
    }
    const found = gatedAdvisories(report);
    const fresh = [...found].filter(([id]) => !(id in known));
    const stale = Object.keys(known).filter((id) => !found.has(id));
    for (const [id, what] of fresh) {
      console.log(`::error::${dir}: NEW ${what} — https://github.com/advisories/${id}`);
    }
    for (const id of stale) {
      console.log(`::warning::${dir}: baseline entry ${id} no longer appears — remove it from scripts/npm-advisory-baseline.json`);
    }
    console.log(`${dir}: ${found.size} high/critical, ${found.size - fresh.length} in the baseline, ${fresh.length} new`);
    if (fresh.length > 0) failed = true;
  }
  if (failed) {
    console.log('::error::A high or critical npm advisory is not in the baseline. Fix it (a bump or a scoped');
    console.log('::error::`overrides` entry), or, if it has no fix and is unreachable, add it to');
    console.log('::error::scripts/npm-advisory-baseline.json with the reachability finding as its reason.');
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
