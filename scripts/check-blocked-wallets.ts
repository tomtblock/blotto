/**
 * The wallet-blocklist gate (terms/privacy change, 2026-09-19).
 *
 * `config/blocked-wallets.json` is founder-owned and decides who is refused
 * an entry. It is the mechanism behind the terms clause "Refusing entry and
 * withholding a prize", which promises something specific:
 *
 *   "Where we do either, we will tell you which ground we relied on."
 *
 * That promise is keepable only if the ground was written down when the
 * decision was taken. The service does not store one — a reason is for the
 * record and for the player who asks, not for a runtime decision — so it
 * lives in `config/blocked-wallets.README.md`, and this refuses the build on
 * each of the four ways the pair can go wrong quietly:
 *
 *   1. THE FILE DOES NOT PARSE. Checked with the REAL parser,
 *      `parseWalletBlocklist` from backend/packet, never a second
 *      implementation. A checker with its own parser tests the checker.
 *
 *   2. AN ADDRESS HAS NO ROW IN THE LEGEND. This is the one that matters: a
 *      refusal we cannot explain is a promise broken at the moment a player
 *      asks us to keep it.
 *
 *   3. A ROW NAMES AN ADDRESS THE FILE DOES NOT CARRY. Either direction of
 *      disagreement means somebody edited one and not the other.
 *
 *   4. A ROW CITES A GROUND THE TERMS DO NOT ENUMERATE. The clause is
 *      enforceable BECAUSE it is enumerated (Consumer Rights Act 2015
 *      Schedule 2 paragraph 16 — a term letting the trader decide whether
 *      its own service conforms is not binding on the consumer). A seventh
 *      ground invented in a config file is the discretion the clause was
 *      deliberately written to avoid.
 *
 * Mirrors `scripts/check-territories.ts`, including its self-test.
 *
 * Run: npx tsx scripts/check-blocked-wallets.ts [--self-test]
 * Exit: 0 clean · 1 the tree is wrong · 2 this gate is broken.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  parseWalletBlocklist,
  type WalletBlocklist,
} from '../backend/packet/src/blocked-wallets';

const ROOT = resolve(__dirname, '..');

/**
 * The only grounds the terms enumerate. Kept here as well as in the README
 * so the gate refuses an invented one — the enumeration is what makes the
 * clause binding.
 */
export const GROUNDS = [
  'integrity',
  'multiple-addresses',
  'territory',
  'under-18',
  'sanctions-listed',
  'terms-breach',
] as const;

export interface LegendRow {
  address: string;
  ground: string;
  decided: string;
}

/**
 * Rows of the README's "Live" table, which is the legend for what the file
 * carries. Held addresses would live under a later heading and are
 * deliberately not collected — the same rule the territory legend follows.
 */
export function legendRows(markdown: string): LegendRow[] {
  const start = markdown.indexOf('\n## Live');
  if (start === -1) throw new Error('blocked-wallets.README.md: no "## Live" section');
  const rest = markdown.slice(start + 1);
  const end = rest.indexOf('\n## ');
  const section = end === -1 ? rest : rest.slice(0, end);
  const rows: LegendRow[] = [];
  for (const line of section.split('\n')) {
    // Table rows only: `| `addr` | ground | date | … |`. The leading pipe
    // keeps prose that happens to quote an address out of the legend, and
    // the backticks keep the header and separator rows out.
    if (!line.startsWith('|')) continue;
    const m = /^\|\s*`([1-9A-HJ-NP-Za-km-z]{32,44})`\s*\|\s*`?([a-z0-9-]+)`?\s*\|\s*([^|]*?)\s*\|/.exec(
      line
    );
    if (m) rows.push({ address: m[1], ground: m[2], decided: m[3] });
  }
  return rows;
}

export function checkBlocklist(opts: { blocklistJson: string; readme: string }): string[] {
  const failures: string[] = [];

  let list: WalletBlocklist;
  try {
    list = parseWalletBlocklist(opts.blocklistJson);
  } catch (e) {
    // Nothing below is meaningful without a parsed list.
    return [`blocked-wallets(1) FAILED: ${e instanceof Error ? e.message : String(e)}`];
  }

  let rows: LegendRow[];
  try {
    rows = legendRows(opts.readme);
  } catch (e) {
    return [`blocked-wallets(2) FAILED: ${e instanceof Error ? e.message : String(e)}`];
  }

  // (2) Every listed address has a row with a ground and a date.
  const byAddress = new Map(rows.map((r) => [r.address, r]));
  for (const wallet of list.wallets) {
    const row = byAddress.get(wallet);
    if (!row) {
      failures.push(
        `blocked-wallets(2) FAILED: ${wallet} is on the list but has no row in the Live table of ` +
          `config/blocked-wallets.README.md. The terms undertake to tell a refused player which ` +
          `ground we relied on, and that is only keepable if the ground was recorded when the ` +
          `decision was taken.`
      );
      continue;
    }
    if (row.decided.trim().length === 0) {
      failures.push(
        `blocked-wallets(2) FAILED: ${wallet}'s row records no date — the decision's date is part ` +
          `of the record`
      );
    }
  }

  // (3) And every row names an address the file carries.
  const listed = new Set(list.wallets);
  for (const row of rows) {
    if (!listed.has(row.address)) {
      failures.push(
        `blocked-wallets(3) FAILED: ${row.address} has a row in the Live table of ` +
          `config/blocked-wallets.README.md but is not on the list — move it to the Held section, ` +
          `or add it to config/blocked-wallets.json`
      );
    }
  }

  // (4) And cites one of the enumerated grounds.
  const grounds = new Set<string>(GROUNDS);
  for (const row of rows) {
    if (!grounds.has(row.ground)) {
      failures.push(
        `blocked-wallets(4) FAILED: ${row.address}'s row cites "${row.ground}", which is not one ` +
          `of the grounds the terms enumerate (${GROUNDS.join(', ')}). The clause is enforceable ` +
          `BECAUSE it is enumerated; a ground invented in a config file is the unfettered ` +
          `discretion it was written to avoid.`
      );
    }
  }

  return failures;
}

// ---------------------------------------------------------------------------
// The gate tests itself. A rule that does not fire on a deliberate violation
// is not enforcing anything — the same standard as check-territories.ts.
// ---------------------------------------------------------------------------

const A = '9'.repeat(43) + 'A';
const B = '8'.repeat(43) + 'B';

const README = (rows: string) => `
# legend

## Live — list version 1

| Address | Ground | Decided | Note |
|---|---|---|---|
${rows}

## Held

Nothing is held.
`;

function selfTest(): boolean {
  const ok = (name: string, cond: boolean) => {
    if (!cond) console.error(`self-test FAILED: ${name}`);
    return cond;
  };
  const json = (wallets: string[]) =>
    JSON.stringify({ version: 1, wallets, updated: '2026-09-19' });

  let pass = true;
  pass =
    ok(
      'an empty list with an empty legend passes — how it ships',
      checkBlocklist({ blocklistJson: json([]), readme: README('') }).length === 0
    ) && pass;
  pass =
    ok(
      'a listed address with a row passes',
      checkBlocklist({
        blocklistJson: json([A]),
        readme: README(`| \`${A}\` | integrity | 2026-09-19 | two entries, one device |`),
      }).length === 0
    ) && pass;
  pass =
    ok(
      'a listed address with NO row fails',
      checkBlocklist({ blocklistJson: json([A]), readme: README('') }).some((f) =>
        f.includes('blocked-wallets(2)')
      )
    ) && pass;
  pass =
    ok(
      'a row with no address on the list fails',
      checkBlocklist({
        blocklistJson: json([]),
        readme: README(`| \`${A}\` | integrity | 2026-09-19 | |`),
      }).some((f) => f.includes('blocked-wallets(3)'))
    ) && pass;
  pass =
    ok(
      'a row citing an invented ground fails',
      checkBlocklist({
        blocklistJson: json([A]),
        readme: README(`| \`${A}\` | we-didnt-like-them | 2026-09-19 | |`),
      }).some((f) => f.includes('blocked-wallets(4)'))
    ) && pass;
  pass =
    ok(
      'a row with no date fails',
      checkBlocklist({
        blocklistJson: json([A]),
        readme: README(`| \`${A}\` | integrity |  | |`),
      }).some((f) => f.includes('records no date'))
    ) && pass;
  pass =
    ok(
      'malformed JSON fails',
      checkBlocklist({ blocklistJson: '{', readme: README('') })[0]?.includes(
        'blocked-wallets(1)'
      ) === true
    ) && pass;
  pass =
    ok(
      'a README with no Live section fails',
      checkBlocklist({ blocklistJson: json([]), readme: '# nothing' }).some((f) =>
        f.includes('blocked-wallets(2)')
      )
    ) && pass;
  pass =
    ok(
      'two addresses each need their own row',
      checkBlocklist({
        blocklistJson: json([A, B]),
        readme: README(`| \`${A}\` | integrity | 2026-09-19 | |`),
      }).some((f) => f.includes(B))
    ) && pass;
  // The ground list is the terms'. A change to one without the other is the
  // failure this pins.
  pass = ok('the enumerated grounds are six', GROUNDS.length === 6) && pass;
  return pass;
}

function main(): void {
  if (!selfTest()) {
    console.error(
      'wallet blocklist gate: THE GATE ITSELF IS BROKEN — fix the check, never the probe.'
    );
    process.exit(2);
  }
  if (process.argv.includes('--self-test')) {
    console.log('wallet blocklist: self-test passed');
    return;
  }

  const blocklistJson = readFileSync(resolve(ROOT, 'config', 'blocked-wallets.json'), 'utf8');
  const failures = checkBlocklist({
    blocklistJson,
    readme: readFileSync(resolve(ROOT, 'config', 'blocked-wallets.README.md'), 'utf8'),
  });
  if (failures.length > 0) {
    console.error('wallet blocklist gate: FAILED\n');
    for (const f of failures) console.error(`  ${f}`);
    console.error('\nconfig/blocked-wallets.json is founder-owned: fix the legend to match it, and');
    console.error('change the list itself only on a founder instruction.');
    process.exit(1);
  }
  const count = parseWalletBlocklist(blocklistJson).wallets.length;
  console.log(
    `wallet blocklist: clean (self-test passed) — ${count} address${count === 1 ? '' : 'es'} listed` +
      (count === 0 ? ', the mechanism exists and nobody is on it' : ', each with a recorded ground')
  );
}

if (require.main === module) main();
