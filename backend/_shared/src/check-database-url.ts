/**
 * Preflight: prove `BLOTTO_DATABASE_URL` works BEFORE a deploy replaces a
 * machine. The reasoning, and the outage that bought it, are in
 * `db-preflight.ts`.
 *
 * Two questions, in order:
 *
 *   1. Is the url's TLS posture fit for this cluster? Decided from the
 *      string alone. A refusal here stops before anything is dialled —
 *      there is no point opening a connection we have already judged unfit,
 *      least of all a plaintext one.
 *   2. Does a session actually open? `SELECT 1` through the SAME `pg` client
 *      every service runs on, so that what passes here is what boots. A
 *      libpq probe (`psql`, already on the runner and free) would NOT do:
 *      libpq and pg-connection-string read `sslmode` differently, so a
 *      certificate that libpq accepts and node refuses is exactly the
 *      failure this check has to catch, and exactly the one it would miss.
 *
 * NOTHING HERE PRINTS THE DRIVER'S ERROR TEXT. The url is a secret in whole:
 * password AND host. See `db-preflight.ts`.
 *
 * Run:  npx tsx backend/_shared/src/check-database-url.ts
 * Env:  BLOTTO_DATABASE_URL (required) · BLOTTO_CLUSTER (unset → devnet)
 * Exit: 0 clean · 1 this deployment must not proceed · 2 the check is broken.
 */

import { appendFileSync } from 'fs';
import { Client } from 'pg';
import { parseCluster } from './cluster';
import { POSTGRES_ENV } from './config';
import {
  PROBE_STATEMENT,
  PROBE_TIMEOUT_MS,
  describeConnectError,
  inspectUrl,
  type Verdict,
} from './db-preflight';

const LABEL = 'database url';

/**
 * Open one session, run one statement, close it.
 *
 * Resolves with a sentence on failure and `null` on success — a failure to
 * connect is an ordinary outcome of this check, not an exception. The only
 * throw that escapes is one from this file's own logic, which `main` reports
 * as a broken check rather than a failing deployment.
 *
 * Both timeouts are set AND the whole thing is raced: `connectionTimeoutMillis`
 * covers opening the socket, `query_timeout` covers the statement, and the
 * race covers a TLS handshake that stalls between the two. A preflight that
 * can hang has replaced a five-minute health-check timeout with its own.
 */
export async function probe(url: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<string | null> {
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    // One session, opened and closed; no keepalive, no pool, no retry. This
    // proves the credential, and proving it twice proves nothing more.
    application_name: 'blotto-deploy-preflight',
  });

  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('preflight'), { code: 'ETIMEDOUT' })), timeoutMs);
  });

  try {
    await Promise.race([
      (async () => {
        await client.connect();
        await client.query(PROBE_STATEMENT);
      })(),
      expiry,
    ]);
    return null;
  } catch (err) {
    return describeConnectError(err);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // `end()` on a client that never connected rejects; the session is gone
    // either way and a cleanup failure must not become the reported problem.
    await client.end().catch(() => undefined);
  }
}

/** Lines for the run summary panel, so a reader need not open the log. */
export function summaryLines(verdict: Verdict, cluster: string, connected: boolean): string[] {
  const lines = [`### Preflight — the ${LABEL}`, ''];
  lines.push(`Cluster: \`${cluster}\`.`, '');
  lines.push(connected ? `A session opened and \`${PROBE_STATEMENT}\` returned.` : 'No session was opened.');
  if (verdict.refusals.length > 0) {
    lines.push('', '**This deploy was refused:**', '');
    for (const r of verdict.refusals) lines.push(`- ${r}`);
  }
  if (verdict.warnings.length > 0) {
    lines.push('', '**Worth reading, not blocking:**', '');
    for (const w of verdict.warnings) lines.push(`- ${w}`);
  }
  return lines;
}

/**
 * Where the summary panel goes, taken from `--summary=<path>` and never from
 * the environment.
 *
 * The caller passes GitHub's `$GITHUB_STEP_SUMMARY` in. That is deliberate:
 * `scripts/check-env-examples.sh` requires every variable the backend reads
 * to appear in `backend/.env.example`, which is the deploy checklist, and a
 * path the runner provides is not something an operator sets. Listing it
 * there to satisfy a pattern would put a non-configurable on a list of
 * things to configure — which is how a checklist stops being read.
 */
function summaryPath(argv: readonly string[]): string | null {
  const flag = argv.find((a) => a.startsWith('--summary='));
  const path = flag?.slice('--summary='.length) ?? '';
  return path === '' ? null : path;
}

function writeSummary(path: string | null, lines: readonly string[]): void {
  if (path === null) return;
  try {
    appendFileSync(path, `${lines.join('\n')}\n`);
  } catch {
    // A summary panel is a courtesy. Losing it must never fail a deploy that
    // is otherwise fine, nor pass one that is not.
  }
}

async function main(): Promise<void> {
  const cluster = parseCluster(process.env.BLOTTO_CLUSTER);
  const url = process.env[POSTGRES_ENV.url] ?? '';
  const verdict = inspectUrl(url, cluster);

  const summary = summaryPath(process.argv.slice(2));

  if (verdict.refusals.length > 0) {
    report(summary, verdict, cluster, false);
    process.exit(1);
  }

  const failure = await probe(url);
  if (failure !== null) {
    const refused: Verdict = { refusals: [failure], warnings: verdict.warnings };
    report(summary, refused, cluster, false);
    process.exit(1);
  }

  report(summary, verdict, cluster, true);
}

function report(summary: string | null, verdict: Verdict, cluster: string, connected: boolean): void {
  writeSummary(summary, summaryLines(verdict, cluster, connected));

  for (const w of verdict.warnings) {
    // An annotation, so it survives on the run page rather than only in a log
    // nobody opens on a green run.
    console.log(`::warning::${LABEL}: ${w}`);
  }

  if (verdict.refusals.length > 0) {
    console.error(`${LABEL}: REFUSED — no machine has been touched\n`);
    for (const r of verdict.refusals) console.error(`  ${r}`);
    return;
  }

  const suffix = verdict.warnings.length > 0 ? `, with ${verdict.warnings.length} warning(s) above` : '';
  console.log(
    `${LABEL}: clean on ${cluster} — a session opened and ${PROBE_STATEMENT} returned${suffix}`
  );
}

if (require.main === module) {
  main().catch((err: unknown) => {
    // A throw from this file's own logic, not from the database. Report the
    // shape and never the text: an error raised while parsing a connection
    // string quotes that string back.
    const name = err instanceof Error ? err.constructor.name : typeof err;
    const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
    console.error(
      `${LABEL}: THE CHECK ITSELF IS BROKEN (${name}${typeof code === 'string' ? ` / ${code}` : ''}) — ` +
        'fix the check, never the probe. No conclusion was reached about this deployment.'
    );
    process.exit(2);
  });
}
