/*
 * diagnose.yml, evidence step: run one round of the watcher's checks and
 * write every verdict to a file, for Claude to read beside the logs. Sends
 * nothing anywhere. Usage:
 *
 *   ts-node src/cli/snapshot.ts <out.json>
 *
 * Reads WATCH_PROVIDER_RPC_URL and WATCH_GITHUB_TOKEN (the run's own
 * read-only token) when set; never prints them.
 *
 * Off Fly's private network (no FLY_APP_NAME, which Fly sets on every
 * machine) the services' metrics cannot be reached, so those verdicts are
 * written as not measured rather than as failures (alerts.ts).
 */

import * as fs from 'fs';
import { metricsNotMeasuredHere } from '../alerts';
import { loadEnv, loadWatchConfig } from '../config';
import { Github } from '../github';
import { Watcher } from '../main';
import { StdoutNotifier } from '../telegram';

async function run(): Promise<void> {
  const out = process.argv[2];
  if (!out) throw new Error('usage: snapshot.ts <out.json>');
  const cfg = loadWatchConfig();
  const env = loadEnv({ ...process.env, WATCH_DRY_RUN: '1' });
  const w = new Watcher(cfg, env, new StdoutNotifier(), new Github(env.githubRepo, env.githubToken), Date.now());
  // Lanes are read on the first round; the provider is probed on the first round.
  const onFly = Boolean(process.env.FLY_APP_NAME);
  const results = (await w.inspect(Date.now())).map((r) => (onFly ? r : metricsNotMeasuredHere(r)));
  const rows = results.map((r) => ({ key: r.key, status: r.status, title: r.title, detail: r.detail, facts: r.facts ?? {} }));
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), results: rows }, null, 2));
}

run().catch((e) => {
  console.error(`snapshot: ${(e as Error).message}`);
  process.exit(1);
});
