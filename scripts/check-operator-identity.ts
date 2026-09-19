/**
 * The operator-identity gate (terms/privacy change, 2026-09-19).
 *
 * The terms of service and the privacy notice have to name a counterparty:
 * who the agreement is with, where a notice is sent, whose law governs it,
 * and — for the privacy notice — which supervisory authority a complaint
 * goes to. No company exists yet, so every one of those is `null` in
 * `config/operator.json` and both pages render "not yet set", exactly as the
 * custody page already does for its timelock. That is the honest state and
 * it is deliberately visible.
 *
 * What must never happen is REAL MONEY moving under terms with no
 * counterparty in them. So:
 *
 *   - ON ANY CLUSTER, the file must parse and carry every key. A renamed or
 *     dropped key would make a page render nothing at all where it promises
 *     to render "not yet set", and that is a silent failure.
 *   - ON MAINNET, every value must be set. A null there is a refusal.
 *
 * The cluster comes from `BLOTTO_CLUSTER` (the same variable the services
 * read), or from `--cluster=<name>`; anything that is not recognisably
 * mainnet is treated as a development cluster. FAIL CLOSED on the schema:
 * a file that cannot be parsed is a refusal on every cluster.
 *
 * Run: npx tsx scripts/check-operator-identity.ts [--self-test] [--cluster=X]
 * Exit: 0 clean · 1 the tree is wrong · 2 this gate is broken.
 *
 * Founder action to close the mainnet half: fill in the seven values in
 * `config/operator.json` once the operating entity exists. One file, no code.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '..');

/**
 * Every key the documents render, with the surface that renders it. A key
 * added here without a surface is a value nobody reads; a surface added
 * without a key here escapes the mainnet refusal.
 */
export const OPERATOR_KEYS = [
  'legalName',
  'companyNumber',
  'registeredAddress',
  'noticeAddress',
  'governingLaw',
  'jurisdiction',
  'supervisoryAuthority',
] as const;

export type OperatorKey = (typeof OPERATOR_KEYS)[number];

/** True when this cluster name means real money. */
export function isMainnetCluster(cluster: string | undefined): boolean {
  return /mainnet/i.test(cluster ?? '');
}

/**
 * The whole decision, pure: the file's text and the cluster in, refusals
 * out. Empty array = go.
 */
export function operatorIdentityRefusals(opts: {
  configJson: string;
  cluster: string | undefined;
}): string[] {
  let raw: unknown;
  try {
    raw = JSON.parse(opts.configJson);
  } catch {
    return ['operator(1) FAILED: config/operator.json is not valid JSON'];
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return ['operator(1) FAILED: config/operator.json is not an object'];
  }
  const doc = raw as Record<string, unknown>;
  const failures: string[] = [];

  if (!Number.isInteger(doc.version) || (doc.version as number) < 1) {
    failures.push('operator(1) FAILED: version must be a positive integer');
  }
  if (typeof doc.updated !== 'string' || doc.updated.length === 0) {
    failures.push('operator(1) FAILED: updated must be a non-empty string');
  }

  // (2) The schema, on every cluster. A key that is absent renders as
  // `undefined`, which is not the same as the declared, rendered `null`.
  for (const key of OPERATOR_KEYS) {
    if (!(key in doc)) {
      failures.push(
        `operator(2) FAILED: ${key} is missing — every key ships present and null, because ` +
          `the terms and privacy pages render "not yet set" from null and render nothing from ` +
          `a key that is not there`
      );
      continue;
    }
    const v = doc[key];
    if (v !== null && (typeof v !== 'string' || v.trim().length === 0)) {
      failures.push(
        `operator(2) FAILED: ${key} must be null or a non-empty string, not ${JSON.stringify(v)}`
      );
    }
  }

  // (3) The mainnet half. Nothing below fires on a development cluster, and
  // the message says what closes it.
  if (isMainnetCluster(opts.cluster)) {
    const unset = OPERATOR_KEYS.filter((k) => doc[k] === null || !(k in doc));
    if (unset.length > 0) {
      failures.push(
        `operator(3) FAILED: cluster ${opts.cluster} is mainnet and ${unset.join(', ')} ` +
          `${unset.length === 1 ? 'is' : 'are'} not set. The terms name the counterparty a ` +
          `player agrees with and the privacy notice names the controller of their data; both ` +
          `render "not yet set" until config/operator.json carries them. Fill that file in — ` +
          `it is a founder action and needs no code change — or do not deploy to mainnet.`
      );
    }
  }

  return failures;
}

/** What is still unset, for the informational line on a development cluster. */
export function unsetKeys(configJson: string): OperatorKey[] {
  try {
    const doc = JSON.parse(configJson) as Record<string, unknown>;
    return OPERATOR_KEYS.filter((k) => doc[k] === null || !(k in doc));
  } catch {
    return [...OPERATOR_KEYS];
  }
}

// ---------------------------------------------------------------------------
// The gate tests itself. A rule that does not fire on a deliberate violation
// is not enforcing anything — the same standard as check-territories.ts.
// ---------------------------------------------------------------------------

const FULL = JSON.stringify({
  version: 1,
  legalName: 'Example Operating Ltd',
  companyNumber: '00000000',
  registeredAddress: '1 Example Street, Exampleton',
  noticeAddress: 'notices@example.invalid',
  governingLaw: 'the law of England and Wales',
  jurisdiction: 'the courts of England and Wales',
  supervisoryAuthority: "the Example Data Protection Authority",
  updated: '2026-09-19',
});

const EMPTY = JSON.stringify({
  version: 1,
  legalName: null,
  companyNumber: null,
  registeredAddress: null,
  noticeAddress: null,
  governingLaw: null,
  jurisdiction: null,
  supervisoryAuthority: null,
  updated: '2026-09-19',
});

function selfTest(): boolean {
  const ok = (name: string, cond: boolean) => {
    if (!cond) console.error(`self-test FAILED: ${name}`);
    return cond;
  };
  let pass = true;
  pass =
    ok(
      'the shipped all-null file passes on devnet',
      operatorIdentityRefusals({ configJson: EMPTY, cluster: 'devnet' }).length === 0
    ) && pass;
  pass =
    ok(
      'the same file is refused on mainnet',
      operatorIdentityRefusals({ configJson: EMPTY, cluster: 'mainnet-beta' }).some((f) =>
        f.includes('operator(3)')
      )
    ) && pass;
  pass =
    ok(
      'a fully populated file passes on mainnet',
      operatorIdentityRefusals({ configJson: FULL, cluster: 'mainnet-beta' }).length === 0
    ) && pass;
  pass =
    ok(
      'ONE null value is enough to refuse mainnet',
      operatorIdentityRefusals({
        configJson: FULL.replace('"the courts of England and Wales"', 'null'),
        cluster: 'mainnet',
      }).some((f) => f.includes('jurisdiction'))
    ) && pass;
  pass =
    ok(
      'a missing key fails on every cluster',
      operatorIdentityRefusals({
        configJson: EMPTY.replace('"governingLaw":null,', ''),
        cluster: 'devnet',
      }).some((f) => f.includes('operator(2)'))
    ) && pass;
  pass =
    ok(
      'an empty string is not a value',
      operatorIdentityRefusals({
        configJson: EMPTY.replace('"legalName":null', '"legalName":"  "'),
        cluster: 'devnet',
      }).some((f) => f.includes('operator(2)'))
    ) && pass;
  pass =
    ok(
      'malformed JSON is refused on a development cluster too',
      operatorIdentityRefusals({ configJson: '{', cluster: 'devnet' })[0]?.includes('operator(1)') ===
        true
    ) && pass;
  pass = ok('the cluster test reads mainnet-beta', isMainnetCluster('mainnet-beta')) && pass;
  pass = ok('the cluster test does not read devnet', !isMainnetCluster('devnet')) && pass;
  pass = ok('an unset cluster is not mainnet', !isMainnetCluster(undefined)) && pass;
  return pass;
}

function main(): void {
  if (!selfTest()) {
    console.error('operator gate: THE GATE ITSELF IS BROKEN — fix the check, never the probe.');
    process.exit(2);
  }
  if (process.argv.includes('--self-test')) {
    console.log('operator identity: self-test passed');
    return;
  }

  const flag = process.argv.find((a) => a.startsWith('--cluster='));
  const cluster = flag ? flag.slice('--cluster='.length) : process.env.BLOTTO_CLUSTER;
  const configJson = readFileSync(resolve(ROOT, 'config', 'operator.json'), 'utf8');
  const failures = operatorIdentityRefusals({ configJson, cluster });

  if (failures.length > 0) {
    console.error('operator gate: FAILED\n');
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }

  const unset = unsetKeys(configJson);
  if (unset.length > 0) {
    // Not a failure on a development cluster — it is the disclosed state,
    // said out loud so it cannot be forgotten. A mainnet deploy refuses.
    console.log(
      `operator identity: clean (self-test passed) — ${unset.length} of ${OPERATOR_KEYS.length} ` +
        `values not yet set (${unset.join(', ')}); the pages render "not yet set" and a mainnet ` +
        `deploy is refused until they are filled in`
    );
    return;
  }
  console.log('operator identity: clean (self-test passed) — every value set');
}

if (require.main === module) main();
