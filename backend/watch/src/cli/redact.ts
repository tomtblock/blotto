/*
 * diagnose.yml, evidence step: redact every file in a directory, in place,
 * before Claude reads any of it. Prints only counts. Usage:
 *
 *   ts-node src/cli/redact.ts <dir> [--keep=<addr>,<addr>…]
 */

import * as fs from 'fs';
import * as path from 'path';
import { redact } from '../redact';
import { PROGRAM_ID } from '../solana';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: redact.ts <dir> [--keep=a,b]');
  process.exit(2);
}
const keepArg = process.argv.find((a) => a.startsWith('--keep='));
const keep = [PROGRAM_ID, ...(keepArg ? keepArg.slice('--keep='.length).split(',').filter(Boolean) : [])];

let files = 0;
const totals: Record<string, number> = {};
for (const name of fs.readdirSync(dir)) {
  const file = path.join(dir, name);
  if (!fs.statSync(file).isFile()) continue;
  const { text, counts } = redact(fs.readFileSync(file, 'utf8'), keep);
  fs.writeFileSync(file, text);
  files += 1;
  for (const [k, n] of Object.entries(counts)) totals[k] = (totals[k] ?? 0) + (n ?? 0);
}
console.log(`redacted ${files} file(s): ${JSON.stringify(totals)}`);
