/**
 * One clean database per process, built by the real migration runner.
 *
 * Every spec file in this package asks for `sharedDatabase()`. The first
 * caller drops the `public` schema and applies all of
 * `backend/_shared/migrations/` through `backend/indexer/src/migrate.ts` —
 * the same function the indexer image runs at boot — and every later caller
 * gets that same pool. So the schema each store is tested against is the one
 * the migrations actually produce, and the from-clean run is exercised on
 * every invocation of the suite rather than described in a README.
 *
 * The `MigrationRun` of that first application is kept, because it is itself
 * under test: `test/migrations.spec.ts` asserts what it applied and what it
 * declared.
 */

import type { Pool } from 'pg';
import { migrate, type MigrationRun } from '../../../backend/indexer/src/migrate';
import { freshDatabase, testPool } from './db';

export interface SharedDatabase {
  pool: Pool;
  /** What the from-clean migration run did. */
  firstRun: MigrationRun;
}

let pending: Promise<SharedDatabase> | null = null;

/** The process's database: dropped, migrated from clean, then shared. */
export function sharedDatabase(): Promise<SharedDatabase> {
  if (pending === null) {
    pending = (async () => {
      const pool = testPool();
      await freshDatabase(pool);
      const firstRun = await migrate(pool);
      return { pool, firstRun };
    })();
  }
  return pending;
}

/**
 * Close the shared pool. Registered once as a ROOT `after` hook (in
 * `test/migrations.spec.ts`, which owns the database's creation), so mocha's
 * process exits instead of hanging on an open connection.
 */
export async function closeSharedDatabase(): Promise<void> {
  if (pending === null) return;
  const { pool } = await pending;
  pending = null;
  await pool.end();
}
