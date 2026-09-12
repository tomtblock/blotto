/**
 * The harness for the one suite in this repository that executes SQL.
 *
 * WHY IT EXISTS (audit 2026-09-11, A-03 / G-03 / G-04 / G-17). Every
 * Postgres-backed store in the backend had zero coverage: all seven
 * adapters, the projection executor and the migration runner were driven
 * only through in-memory twins, and no CI job ever started a database. Two
 * live defects came straight out of that shape — the archive rewrote the
 * served rankings outside any transaction (B-20 / F-05), and the decision
 * log destroyed the signed timestamp on read-back (A-04) — and neither was
 * reachable by a test that never met a real schema, a real transaction or a
 * real unique constraint.
 *
 * WHAT "FROM CLEAN" MEANS HERE. `freshDatabase()` drops the whole `public`
 * schema and recreates it before running the migrations. That is the check
 * `backend/_shared/migrations/README.md` says nothing performs: the
 * conventions promise a fresh environment and a long-lived one converge on
 * the same schema, and until now the only thing testing it was a Fly machine
 * booting in production.
 *
 * THE GATE. Without `BLOTTO_TEST_DATABASE_URL` every case is PENDING, never
 * silently green — the same posture `backend/sealing/test/turnkey-live.spec.ts`
 * takes with its credentials. A developer with no Postgres still runs
 * everything else; CI always has one (`.github/workflows/postgres.yml`).
 *
 * THE DATABASE IS DESTROYED. Point this at a scratch database and nothing
 * else. `freshDatabase()` refuses a URL whose database name does not say so.
 */

import { Pool } from 'pg';

/** The scratch database, or undefined when this machine has none. */
export const DATABASE_URL: string | undefined =
  process.env.BLOTTO_TEST_DATABASE_URL?.trim() || undefined;

/** True when the suite can run. Every spec file gates its `describe` on it. */
export const CONFIGURED = DATABASE_URL !== undefined;

/**
 * A database name must contain one of these before this harness will drop
 * its schema. The suite is destructive by design and the one mistake it
 * must not allow is being pointed at something that matters.
 */
const SCRATCH_NAMES = ['test', 'scratch', 'ci', 'tmp'];

function databaseName(url: string): string {
  // A libpq URL's path is `/<database>`; a query string may follow.
  const withoutQuery = url.split('?')[0];
  const lastSlash = withoutQuery.lastIndexOf('/');
  return lastSlash === -1 ? '' : withoutQuery.slice(lastSlash + 1);
}

/** Open a pool against the scratch database. Caller closes it. */
export function testPool(): Pool {
  if (!DATABASE_URL) {
    throw new Error('BLOTTO_TEST_DATABASE_URL is not set — this suite should have been skipped');
  }
  const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
  // Mirrors `createPool`'s handler: an unhandled 'error' on the pool kills
  // the process, and mocha would report it as a crash rather than a failure.
  pool.on('error', (err) => {
    console.error('test pool: idle client error (continuing):', err.message);
  });
  return pool;
}

/**
 * Drop and recreate the `public` schema, leaving a genuinely empty database
 * — no tables, no `schema_migrations`, no types. This is what the migration
 * run is then asserted against.
 */
export async function freshDatabase(pool: Pool): Promise<void> {
  const name = databaseName(DATABASE_URL!);
  if (!SCRATCH_NAMES.some((s) => name.toLowerCase().includes(s))) {
    throw new Error(
      `refusing to drop the schema of database '${name}': this suite destroys everything in ` +
        `it, so its name must contain one of ${SCRATCH_NAMES.join(', ')}`
    );
  }
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
}

/** Every table name in `public`, sorted. */
export async function tableNames(pool: Pool): Promise<string[]> {
  const res = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`
  );
  return res.rows.map((r: { table_name: string }) => r.table_name);
}

/** Empty the named tables, leaving the schema in place. */
export async function truncate(pool: Pool, tables: readonly string[]): Promise<void> {
  if (tables.length === 0) return;
  await pool.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}
