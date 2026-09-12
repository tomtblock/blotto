/**
 * The migrations, applied to an empty database (audit 2026-09-11, G-04 and
 * the "Migrations applied to an empty database — NONE" row of §10).
 *
 * `backend/_shared/migrations/README.md` promises four things about these
 * files and nothing checked any of them: that they are runnable from a clean
 * database, that each one is applied inside its own transaction, that the
 * runner is forward-only and idempotent, and that a migration which
 * invalidates a derived table declares it in a line the runner reads. The
 * README says so itself — "Nothing checks this automatically today" — and
 * names the de-facto check: a fresh Fly machine. Discovering that migration
 * 0021 cannot apply to an empty database, by watching a production boot fail,
 * is the failure this file removes.
 *
 * `migrate-marker.spec.ts` in the indexer package already checks the marker
 * MATCHER against the files on disk, offline. What it cannot do is apply
 * them. That is the only difference, and it is the whole point.
 */
import { expect } from 'chai';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  MIGRATIONS_DIR,
  declaresRederive,
  migrate,
} from '../../../backend/indexer/src/migrate';
import { CONFIGURED, tableNames } from '../src/db';
import { closeSharedDatabase, sharedDatabase } from '../src/schema';

/** Every `NNNN_*.sql` on disk, in the order the runner applies them. */
const FILES = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

/**
 * Tables the rest of this suite drives. Named rather than counted: a
 * migration that silently stopped creating one of them would otherwise
 * surface as a confusing failure three spec files later.
 */
const EXPECTED_TABLES = [
  'attestations',
  'bundles',
  'detection_reports',
  'events',
  'notify_optin',
  'player_history',
  'published_bundles',
  'published_pool_keys',
  'rankings',
  'review_decisions',
  'sanctions_refusals',
  'schema_migrations',
  'sealed_entries',
];

(CONFIGURED ? describe : describe.skip)('the migrations, from an empty database', function () {
  this.timeout(120_000);

  it('applies every file on disk, in filename order, on the first run', async () => {
    const { firstRun } = await sharedDatabase();
    expect(firstRun.applied, 'the from-clean run applied every migration').to.deep.equal(FILES);
    expect(FILES.length, 'migrations found on disk').to.be.greaterThan(20);
  });

  it('records each applied file in schema_migrations', async () => {
    const { pool } = await sharedDatabase();
    const res = await pool.query('SELECT filename FROM schema_migrations ORDER BY filename');
    expect(res.rows.map((r: { filename: string }) => r.filename)).to.deep.equal(FILES);
  });

  it('creates the tables the services read and write', async () => {
    const { pool } = await sharedDatabase();
    const tables = await tableNames(pool);
    for (const name of EXPECTED_TABLES) {
      expect(tables, `migrations did not create '${name}'`).to.include(name);
    }
  });

  it('is forward-only: a second run applies nothing and changes nothing', async () => {
    const { pool } = await sharedDatabase();
    const before = await tableNames(pool);
    const again = await migrate(pool);
    expect(again.applied, 'a second run must be a no-op').to.deep.equal([]);
    expect(again.rederiveRequired).to.equal(false);
    expect(await tableNames(pool)).to.deep.equal(before);
  });

  it('reports the re-derive marker for exactly the files that declare it', async () => {
    // The from-clean run applied every file, so its report is the complete
    // answer for the whole directory — which is the case the indexer's
    // offline marker spec cannot reach, because it never applies anything.
    const { firstRun } = await sharedDatabase();
    const onDisk = FILES.filter((f) =>
      declaresRederive(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
    );
    expect(onDisk.length, 'at least 0004 declares the marker').to.be.greaterThan(0);
    expect(firstRun.rederiveRequestedBy).to.deep.equal(onDisk);
    expect(firstRun.rederiveRequired).to.equal(true);
  });

  it('a failing migration is neither recorded nor half-applied', async () => {
    // The README's "each migration runs in its own transaction" claim, read
    // back off the database rather than off the file. The runner is handed a
    // directory of its own: one good file, then one that creates a table and
    // then fails. The good one must be recorded and its table must exist;
    // the bad one must leave neither a row nor a table behind.
    const { pool } = await sharedDatabase();
    const dir = join(__dirname, 'fixtures', 'failing-migrations');
    let threw: Error | null = null;
    try {
      await migrate(pool, dir);
    } catch (e) {
      threw = e as Error;
    }
    expect(threw, 'the run must fail loudly, not swallow the error').to.not.equal(null);

    const applied = await pool.query(
      'SELECT filename FROM schema_migrations WHERE filename LIKE $1 ORDER BY filename',
      ['9%']
    );
    expect(applied.rows.map((r: { filename: string }) => r.filename)).to.deep.equal([
      '9001_good.sql',
    ]);
    const tables = await tableNames(pool);
    expect(tables, 'the migration that committed').to.include('migration_probe_good');
    expect(tables, 'the migration that threw must have left nothing').to.not.include(
      'migration_probe_bad'
    );

    // Leave the shared schema as the other spec files expect to find it.
    await pool.query('DROP TABLE IF EXISTS migration_probe_good');
    await pool.query('DELETE FROM schema_migrations WHERE filename LIKE $1', ['9%']);
  });
});

/**
 * ROOT hook: mocha runs this after every spec file in the package, which is
 * the only point at which the shared pool can be closed without stranding a
 * later file.
 */
after(async () => {
  await closeSharedDatabase();
});
