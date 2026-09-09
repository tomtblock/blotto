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
import {
  buildMonitor,
  loadMonitor,
  createPool,
  registerBlottoEventLayouts,
  ALERT,
  METRIC,
  type Monitor,
} from './shared';
import { loadIndexerConfig, requireWebhookSecret } from './config';
import { migrate } from './migrate';
import { PgEventStore } from './store-pg';
import { createWebhookServer } from './webhook';
import { serveReadApi } from './read-api';
import { catchUpFloor, runBackfill, Web3BackfillRpc } from './backfill';
import { backfillArchive } from './archive';

// INCIDENT 2026-09-09: the decoder's layout table is filled by this call and by
// nothing else. From 2026-08-27 until today no service made it — only the
// projection tests did — so `serve`, `sync` and `backfill` all ran with an EMPTY
// table, every one of our own `Program data:` lines was "unrecognised" (the
// silent path reserved for other programs' events), and the read API served
// `[]` while pools were open on chain. Registering at module load, before any
// command, is deliberate: there is no code path into this service that can
// decode a transaction without passing through here.
// (`test/registration.spec.ts` decodes a real devnet OpenPool line through it.)
registerBlottoEventLayouts();

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

/**
 * Backfill.
 *
 * `bounded: false` (the `backfill` CLI command) walks the program's WHOLE
 * signature history. That is the deliberate reconciliation tool: it is the only
 * thing that can repair a gap BELOW the ingest watermark, which a bounded walk
 * by construction cannot reach.
 *
 * `bounded: true` (the `sync` boot path) stops at `lastIngestedSlot()` — the
 * ingest watermark — so a restart re-reads only what it missed while it was
 * down. `runBackfill` stops at `slot < minSlot`, strictly, so the watermark slot
 * itself is re-walked and its rows land as duplicates: an overlap of one slot
 * rather than a gap, which is the correct side to err on for a recovery path.
 */
async function cmdBackfill(monitor: Monitor, opts: { bounded?: boolean } = {}): Promise<void> {
  const config = loadIndexerConfig();
  const pool = createPool(config.postgres);
  const store = new PgEventStore(pool);
  const rpc = new Web3BackfillRpc(config.rpcUrl, config.programId, config.commitment);
  try {
    // A null watermark means an empty ledger — there is no floor to stop at, so
    // even the bounded walk is a full one. That is right for a first run, and it
    // is precisely why `cmdSync` no longer waits for this before serving.
    const minSlot = opts.bounded ? await catchUpFloor(store) : undefined;
    console.log(
      `backfill: walking ${minSlot === undefined ? 'the full history' : `back to slot ${minSlot}`}`
    );
    const result = await runBackfill(store, monitor,
      { commitment: config.commitment, program: config.programId }, rpc, { minSlot });
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

/**
 * The deployment entry (C12).
 *
 * ORDER IS LOAD-BEARING: migrate, SERVE, then catch up in the background.
 *
 * Incident 2026-09-08. This ran migrate → backfill → serve, so nothing answered
 * `/health` until the catch-up walk finished — and that walk was unbounded (no
 * `minSlot`), replaying the program's entire history against the public devnet
 * RPC on every boot. The cost grew with the program's age until it crossed Fly's
 * health-check patience (`deploy/fly/indexer.fly.toml`: 30s grace), the deploy
 * was declared failed, and the app went down entirely — `min_machines_running =
 * 1` with no healthy machine means no service at all.
 *
 * Serving first breaks the dependency: boot health now rests only on the
 * database, and a backfill that is slow, rate-limited or failing outright no
 * longer takes the service down with it. The webhook is the primary ingest path
 * and is live from the moment we listen; the backfill is the recovery path, and
 * a recovery path must never be able to cause the outage it exists to recover
 * from.
 */
async function cmdSync(monitor: Monitor): Promise<void> {
  await cmdMigrate(monitor);
  await cmdServe(monitor);
  void cmdBackfill(monitor, { bounded: true }).catch((err: unknown) => {
    // Logged, never rethrown: an unhandled rejection here would kill a process
    // that is otherwise healthy and serving. The next boot retries, and the
    // `backfill` command is the manual repair.
    console.error(`${SERVICE}: startup backfill failed (service is serving):`, err);
    monitor.alert(ALERT.indexer.startupBackfillFailed, {
      error: err instanceof Error ? err.message : String(err),
    });
  });
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
