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
import {
  INDEXER_ENV,
  loadIndexerConfig,
  requireWebhookSecret,
  type IndexerConfig,
} from './config';
import { migrate, type MigrationRun } from './migrate';
import { PgEventStore } from './store-pg';
import { createWebhookServer } from './webhook';
import { serveReadApi } from './read-api';
import { backfillAndRederive, catchUpFloor, Web3BackfillRpc } from './backfill';
import { backfillArchive } from './archive';
import { atomicDb } from './atomic';
import { startReconciler } from './reconcile';
import { startMetricsListener } from '../../_shared/src/metrics-listener';

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

async function cmdMigrate(monitor: Monitor): Promise<MigrationRun> {
  const config = loadIndexerConfig();
  const pool = createPool(config.postgres);
  try {
    const run = await migrate(pool);
    monitor.recordEvent(METRIC.indexer.migrate);
    console.log(
      run.applied.length
        ? `migrate: applied ${run.applied.length} migration(s): ${run.applied.join(', ')}`
        : 'migrate: up to date'
    );
    // The standalone command only REPORTS the need: `migrate` is the one
    // command an operator runs against a database whose services are
    // stopped, and replaying the whole ledger under them is not what they
    // asked for. `sync` (the container's entry) acts on it below.
    if (run.rederiveRequired) {
      console.log(
        `migrate: ${run.rederiveRequestedBy.join(', ')} invalidated the derived tables — ` +
          'run `re-derive` (the `sync` boot path does it for you)'
      );
    }
    return run;
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
    archiveDb: atomicDb(pool),
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
  serveReadApi(pool, config.readApiPort, loadHygieneConfig(process.env), {
    trustProxyHeader: process.env.BLOTTO_TRUST_PROXY === '1',
  });
  console.log(`${SERVICE}: read API listening on :${config.readApiPort}`);

  // E-09: the exposition, on the private network only — never on either of
  // the two ports above, both of which the platform routes publicly. A silent
  // no-op on every sink but prometheus.
  startMetricsListener(monitor, SERVICE);

  startReconciliation(store, monitor, config);
}

/**
 * Start the recurring reconciliation (audit C-11 / C-21). The walk itself, and
 * the reasoning for it, live in `reconcile.ts` — split out so a test can drive
 * the tick without a timer.
 */
function startReconciliation(store: PgEventStore, monitor: Monitor, config: IndexerConfig): void {
  if (config.reconcileIntervalMs === 0) {
    console.log(
      `${SERVICE}: reconciliation walk DISABLED (${INDEXER_ENV.reconcileIntervalMs}=0) — ` +
        'a dropped webhook delivery below the ingest watermark will stay missing until ' +
        'someone runs `backfill`'
    );
    return;
  }
  console.log(
    `${SERVICE}: reconciliation walk every ${Math.round(config.reconcileIntervalMs / 1000)}s`
  );
  startReconciler(
    {
      store,
      monitor,
      ctx: { commitment: config.commitment, program: config.programId },
      rpc: () => new Web3BackfillRpc(config.rpcUrl, config.programId, config.commitment),
    },
    config.reconcileIntervalMs
  );
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
    const result = await backfillAndRederive(store, monitor,
      { commitment: config.commitment, program: config.programId }, rpc, { minSlot });
    console.log(
      `backfill: ${result.transactions} tx, ${result.inserted} inserted, ${result.duplicates} duplicates`
    );
    // The walk ingests oldest-first since 2026-09-12 (F-19), so its own rows
    // project correctly as they land. The chained rebuild remains for the case
    // its order cannot fix: rows inserted BELOW the ingest watermark are older
    // than rows the live webhook already projected, so applying them in place
    // would put a pool's opening on top of its settlement. See
    // `backfillAndRederive`'s doc comment.
    if (result.rederived > 0) {
      console.log(`backfill: re-derived ${result.rederived} events in ledger order`);
    }
  } finally {
    await pool.end();
  }
}

async function cmdArchiveBackfill(monitor: Monitor): Promise<void> {
  const config = loadIndexerConfig();
  const pool = createPool(config.postgres);
  try {
    const result = await backfillArchive(atomicDb(pool), fetch, console.log, {
      uploaderAddress: config.irysUploadAddress,
    });
    for (let i = 0; i < result.verified; i++) {
      monitor.recordEvent(METRIC.indexer.archiveVerified);
    }
    console.log(
      `archive-backfill: ${result.attempted} settled pool(s), ` +
        `${result.verified} verified, ${result.failed} failed` +
        (result.seatsUnresolved
          ? `, ${result.seatsUnresolved} verified row(s) with no entry in our ledger — ` +
            'a missed EntryRegistered delivery; run a backfill'
          : '')
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
  const migrated = await cmdMigrate(monitor);
  // E-15 (audit 2026-09-11): a migration that dropped or re-shaped a DERIVED
  // table leaves it empty, and the derived tables are what the read API
  // serves. `0004_seat_payouts.sql` asked for a rebuild in a comment
  // addressed to a human, which nothing read; the boot backfill only chains
  // one when it INSERTED something, which on a normal boot it does not.
  //
  // So: rebuild here, and BEFORE serving. Between the migration and the
  // rebuild the tables are empty, and a read API answering out of them in
  // that window would serve "no tournaments" as though it were the truth.
  // The cost is a ledger replay on the boots that need one and nothing at
  // all on every other boot.
  if (migrated.rederiveRequired) {
    console.log(
      `${SERVICE}: ${migrated.rederiveRequestedBy.join(', ')} invalidated the derived tables — ` +
        'rebuilding before serving'
    );
    await cmdRederive(monitor);
  }
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
      // The run's detail is printed by cmdMigrate; `main` returns nothing.
      await cmdMigrate(monitor);
      return;
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
