/**
 * @blotto/indexer — webhook deliveries and an RPC backfill walk into a Postgres
 * event ledger.
 *
 * CLI dispatch over the four operations:
 *   migrate    — apply the forward-only migrations (clean-DB runnable)
 *   serve      — run the authenticated Helius webhook receiver
 *   backfill   — catch up from RPC through the same write path (dropped-webhook recovery)
 *   re-derive  — rebuild the derived tables from the ledger alone
 *   archive-backfill — discover + verify + ingest every settled pool's
 *                published bundle (E3; idempotent, safe to re-run)
 *   sync       — the deployment entry (C12): migrate, then backfill (the
 *                fallback catches anything the webhook missed while the
 *                process was down), then serve
 *
 * Config (DB URL, RPC URL, program ID, commitment, webhook secret/port) comes from the loader —
 * nothing hard-coded. Ingest health reports through `Monitor` (logging default; Step 6 alerting).
 */
import { loadHygieneConfig } from '../../_shared/src/http-hygiene';
import { buildMonitor, loadMonitor, createPool, METRIC, type Monitor } from './shared';
import { loadIndexerConfig, requireWebhookSecret } from './config';
import { migrate } from './migrate';
import { PgEventStore } from './store-pg';
import { createWebhookServer } from './webhook';
import { serveReadApi } from './read-api';
import { runBackfill, Web3BackfillRpc } from './backfill';
import { backfillArchive } from './archive';

const SERVICE = 'indexer';

async function cmdMigrate(monitor: Monitor): Promise<void> {
  const config = loadIndexerConfig();
  const pool = createPool(config.postgres);
  try {
    const applied = await migrate(pool);
    monitor.recordEvent(METRIC.indexer.migrate);
    console.log(
      applied.length
        ? `migrate: applied ${applied.length} migration(s): ${applied.join(', ')}`
        : 'migrate: up to date'
    );
  } finally {
    await pool.end();
  }
}

async function cmdServe(monitor: Monitor): Promise<void> {
  const config = loadIndexerConfig();
  const secret = requireWebhookSecret();
  const pool = createPool(config.postgres);
  const store = new PgEventStore(pool);
  const server = createWebhookServer({
    store,
    monitor,
    secret,
    commitment: config.commitment,
    program: config.programId,
    // E3: POST /bundles (the daemon's announce) verifies against the same
    // derived tables this process already writes.
    archiveDb: pool,
  });
  server.listen(config.webhookPort, () => {
    console.log(
      `${SERVICE}: webhook listening on :${config.webhookPort} (commitment=${config.commitment})`
    );
  });
  // E5: the public read API rides in the same process, its own port — the
  // app's NEXT_PUBLIC_INDEXER_URL points here.
  // BR-005: CORS/limits from env (BLOTTO_API_CORS_ORIGINS etc.) — the read
  // surface keeps the module's GET-only default methods.
  serveReadApi(pool, config.readApiPort, loadHygieneConfig(process.env));
  console.log(`${SERVICE}: read API listening on :${config.readApiPort}`);
}

async function cmdBackfill(monitor: Monitor): Promise<void> {
  const config = loadIndexerConfig();
  const pool = createPool(config.postgres);
  const store = new PgEventStore(pool);
  const rpc = new Web3BackfillRpc(config.rpcUrl, config.programId, config.commitment);
  try {
    const result = await runBackfill(store, monitor,
      { commitment: config.commitment, program: config.programId }, rpc);
    console.log(
      `backfill: ${result.transactions} tx, ${result.inserted} inserted, ${result.duplicates} duplicates`
    );
  } finally {
    await pool.end();
  }
}

async function cmdArchiveBackfill(monitor: Monitor): Promise<void> {
  const config = loadIndexerConfig();
  const pool = createPool(config.postgres);
  try {
    const result = await backfillArchive(pool);
    for (let i = 0; i < result.verified; i++) {
      monitor.recordEvent(METRIC.indexer.archiveVerified);
    }
    console.log(
      `archive-backfill: ${result.attempted} settled pool(s), ` +
        `${result.verified} verified, ${result.failed} failed`
    );
    // A failed pool is not fatal to the run (the next run retries it),
    // but the exit code says so for cron/CI callers.
    if (result.failed > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

async function cmdRederive(monitor: Monitor): Promise<void> {
  const config = loadIndexerConfig();
  const pool = createPool(config.postgres);
  const store = new PgEventStore(pool);
  try {
    const replayed = await store.rederive();
    monitor.recordEvent(METRIC.indexer.rederive);
    console.log(`re-derive: rebuilt derived tables from ${replayed} ledger event(s)`);
  } finally {
    await pool.end();
  }
}

async function cmdSync(monitor: Monitor): Promise<void> {
  await cmdMigrate(monitor);
  await cmdBackfill(monitor);
  await cmdServe(monitor);
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  // Sink selected by BLOTTO_MONITOR_SINK (default `logging`); `serve` exposes `/metrics` under
  // the `prometheus` sink so one Alloy agent can scrape it (Step 6).
  const monitor = buildMonitor(loadMonitor(), 'indexer');
  // FIRST, before any command can fail: which code is running, and against
  // what. Two deploys on 2026-08-31 shipped code older than the fix and were
  // diagnosed only by comparing a commit on a web page against a branch.
  console.log(`${SERVICE}: build ${process.env.BLOTTO_BUILD_COMMIT ?? 'unknown'}`);

  const command = argv[0];
  switch (command) {
    case 'migrate':
      return cmdMigrate(monitor);
    case 'serve':
      return cmdServe(monitor);
    case 'backfill':
      return cmdBackfill(monitor);
    case 're-derive':
      return cmdRederive(monitor);
    case 'archive-backfill':
      return cmdArchiveBackfill(monitor);
    case 'sync':
      return cmdSync(monitor);
    default:
      console.error(
        `${SERVICE}: unknown command "${command ?? ''}". ` +
          'Usage: indexer <migrate|serve|backfill|re-derive|archive-backfill|sync>'
      );
      process.exitCode = 1;
  }
}

if (require.main === module) {
  void main().catch((err) => {
    console.error(`${SERVICE}: fatal:`, err);
    process.exit(1);
  });
}
