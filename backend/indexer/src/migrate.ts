/**
 * Forward-only migration runner. Applies every `NNNN_*.sql` under
 * `backend/_shared/migrations/` that hasn't run yet, in filename order, each inside its own
 * transaction, and records it in `schema_migrations`. Runnable from a clean DB (the first run
 * applies all of them). Never edits an applied migration — new schema is a higher-numbered file.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Pool } from 'pg';
import { withTransaction } from './shared';

/** backend/_shared/migrations, resolved from this file (backend/indexer/src). */
export const MIGRATIONS_DIR = join(__dirname, '..', '..', '_shared', 'migrations');

function migrationFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/** Apply all pending migrations. Returns the filenames applied this run (empty if up to date). */
export async function migrate(
  pool: Pool,
  dir: string = MIGRATIONS_DIR
): Promise<string[]> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename   TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  );
  const applied = new Set(
    (await pool.query('SELECT filename FROM schema_migrations')).rows.map(
      (r) => r.filename as string
    )
  );

  const pending = migrationFiles(dir).filter((f) => !applied.has(f));
  for (const file of pending) {
    const sql = readFileSync(join(dir, file), 'utf8');
    await withTransaction(pool, async (client) => {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [file]
      );
    });
  }
  return pending;
}
