/**
 * Forward-only migration runner. Applies every `NNNN_*.sql` under
 * `backend/_shared/migrations/` that hasn't run yet, in filename order, each inside its own
 * transaction, and records it in `schema_migrations`. Runnable from a clean DB (the first run
 * applies all of them). Never edits an applied migration — new schema is a higher-numbered file.
 *
 * ## The re-derive marker (audit E-15)
 *
 * A migration may DROP and recreate a derived table. `0004_seat_payouts.sql`
 * did exactly that and told a human about it, in a comment: "Run a re-derive
 * after applying this migration." Nothing read that comment. The boot path
 * (`cmdSync`) runs migrate, then serve, then a bounded backfill that chains a
 * rebuild only when it INSERTED something — which on a normal boot it does
 * not. So a destructive migration left the seven derived tables empty and
 * serving, until a human noticed and dispatched a workflow.
 *
 * The fix is to let a migration DECLARE the invalidation in a form the runner
 * reads, and to report it to the caller so boot can act on it:
 *
 *     -- BLOTTO-MIGRATION: rederive-required
 *
 * in a comment, anywhere in the file. `migrate` returns which applied
 * migrations declared it; the caller chains `store.rederive()`.
 *
 * WHY A MARKER LINE RATHER THAN A FILENAME CONVENTION. The filename is the
 * migration's identity — it is the primary key of `schema_migrations`. A
 * convention like `0018_foo.rederive.sql` therefore cannot be applied to an
 * already-applied migration without renaming the file, and renaming it makes
 * every database that has run it believe it is pending again. `0004` is
 * already applied everywhere, so the mechanism had to be one that could be
 * retrofitted to it as documentation. A marker line can be; a filename cannot.
 *
 * WHY A LINE MATCH RATHER THAN READING THE SQL. Deciding "did this migration
 * empty a derived table" from the SQL itself means implementing enough of
 * Postgres to know what `DROP TABLE`, `TRUNCATE`, a rewritten `ALTER` or a
 * data-destroying `UPDATE` do to seven specific tables. It would be wrong
 * eventually, and it would be wrong silently. A declaration is checkable, and
 * `test/migrate-marker.spec.ts` checks it against the real files on disk.
 *
 * WHY THE MATCH IS DELIBERATELY LOOSE — case-insensitive, on any line, on its
 * own or trailing another statement, with anything allowed between the `--`
 * and the marker. The two failure directions are not symmetric. A false
 * positive costs one unnecessary rebuild of tables that are a pure function of
 * the ledger: seconds, and the result is identical to what was there before. A
 * false negative serves empty derived tables to players. So every judgement
 * call in the matcher goes the way that sees MORE markers, and the one thing
 * the author of migration 0019 has to get right is the spelling of the marker
 * itself — which is `REDERIVE_MARKER`, below, to copy.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Pool } from 'pg';
import { withTransaction } from './shared';

/** backend/_shared/migrations, resolved from this file (backend/indexer/src). */
export const MIGRATIONS_DIR = join(__dirname, '..', '..', '_shared', 'migrations');

/**
 * The exact line a migration writes to declare that it invalidated the derived
 * tables. Copy it verbatim onto a line of its own.
 */
export const REDERIVE_MARKER = '-- BLOTTO-MIGRATION: rederive-required';

/**
 * The marker as matched: anywhere after a `--` on any line, any case. See the
 * header for why the match is loose in every direction it could be strict.
 */
const REDERIVE_MARKER_RE = /--[^\n]*BLOTTO-MIGRATION:[ \t]*rederive-required/i;

/**
 * Does this migration's SQL declare that it invalidated the derived tables?
 *
 * Exported so a test can assert the checker sees the marker in the real files
 * that carry it, and does not see it in the files that do not.
 */
export function declaresRederive(sql: string): boolean {
  return REDERIVE_MARKER_RE.test(sql);
}

/** What one `migrate()` run did. */
export interface MigrationRun {
  /** Filenames applied this run, in the order applied. Empty if up to date. */
  applied: string[];
  /**
   * True when any migration applied this run declared the re-derive marker —
   * exactly `rederiveRequestedBy.length > 0`, named so the boot path reads as
   * a decision rather than as a length check.
   *
   * The caller is expected to rebuild the derived tables (`store.rederive()`)
   * when this is true. `migrate` does not do it itself: it holds a `Pool` and
   * nothing else, while the rebuild belongs to the event store, and a runner
   * that silently replays the whole ledger is a worse thing to own than a
   * runner that reports a fact.
   */
  rederiveRequired: boolean;
  /** The subset of `applied` that declared the marker — for the log line. */
  rederiveRequestedBy: string[];
}

function migrationFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * Apply all pending migrations.
 *
 * Returns the filenames applied this run and whether any of them declared that
 * it invalidated the derived tables (see the header). A migration that throws
 * is not recorded and not reported — its transaction is discarded and the run
 * fails — so `rederiveRequestedBy` only ever names migrations that committed.
 */
export async function migrate(
  pool: Pool,
  dir: string = MIGRATIONS_DIR
): Promise<MigrationRun> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename   TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  );
  const alreadyApplied = new Set(
    (await pool.query('SELECT filename FROM schema_migrations')).rows.map(
      (r) => r.filename as string
    )
  );

  const pending = migrationFiles(dir).filter((f) => !alreadyApplied.has(f));
  const applied: string[] = [];
  const rederiveRequestedBy: string[] = [];
  for (const file of pending) {
    const sql = readFileSync(join(dir, file), 'utf8');
    await withTransaction(pool, async (client) => {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [file]
      );
    });
    // Recorded only after the transaction committed: a migration that failed
    // changed nothing, so it has nothing to invalidate.
    applied.push(file);
    if (declaresRederive(sql)) {
      rederiveRequestedBy.push(file);
    }
  }
  return {
    applied,
    rederiveRequired: rederiveRequestedBy.length > 0,
    rederiveRequestedBy,
  };
}
