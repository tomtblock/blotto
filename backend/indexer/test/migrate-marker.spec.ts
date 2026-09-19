/**
 * The re-derive marker (audit E-15).
 *
 * THE DEFECT. `0004_seat_payouts.sql` DROPs and recreates two derived tables,
 * and told a human so in a comment: "Run a re-derive after applying this
 * migration." Nothing read that comment. The boot path runs migrate, then
 * serve, then a bounded backfill that chains a rebuild only when it INSERTED
 * something — which on a normal boot it does not. So a destructive migration
 * left all seven derived tables empty and serving until a person noticed and
 * dispatched a workflow.
 *
 * THE FIX. A migration declares the invalidation in a marker line; `migrate()`
 * reports which applied migrations carried it; the boot path chains the
 * rebuild. These tests are the "checker proves it sees the marker" half: they
 * run the real checker over the real files on disk, and over the near-misses
 * that a future migration author might actually write.
 */
import { expect } from 'chai';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Pool } from 'pg';
import {
  MIGRATIONS_DIR,
  REDERIVE_MARKER,
  declaresRederive,
  migrate,
  type MigrationRun,
} from '../src/migrate';

function migrationSql(file: string): string {
  return readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
}

/**
 * A `pg.Pool` stand-in. Answers the runner's `schema_migrations` read with
 * `alreadyApplied`, records every other statement, and fails nothing — the
 * contract under test is what `migrate()` REPORTS, not what Postgres does with
 * the SQL.
 */
function fakePool(alreadyApplied: readonly string[] = []): { pool: Pool; executed: string[] } {
  const executed: string[] = [];
  const query = async (text: string, params?: readonly unknown[]): Promise<never> => {
    executed.push(text);
    if (/FROM schema_migrations/.test(text)) {
      return { rows: alreadyApplied.map((filename) => ({ filename })) } as never;
    }
    if (/INSERT INTO schema_migrations/.test(text)) {
      executed.push(`recorded:${String(params?.[0])}`);
    }
    return { rows: [] } as never;
  };
  const client = { query, release: (): void => undefined };
  const pool = { query, connect: async () => client };
  return { pool: pool as unknown as Pool, executed };
}

/** Every `.sql` file in the real migrations directory, in filename order. */
const ALL_MIGRATIONS = [
  '0001_events_ledger.sql',
  '0002_sealed_entries.sql',
  '0003_derived_tables.sql',
  '0004_seat_payouts.sql',
  '0005_terms_version.sql',
  '0006_review_decisions.sql',
  '0007_treasury.sql',
  '0008_player_history.sql',
  '0009_notify_optin.sql',
  '0010_deployment_stores.sql',
  '0011_archive.sql',
  '0012_go_timer.sql',
  '0013_tier_status.sql',
  '0014_resolving_lookup.sql',
  '0015_appeal_thread.sql',
  '0016_published_bundles.sql',
  '0017_rankings_by_player.sql',
  '0018_events_seq.sql',
  '0019_sanctions.sql',
  '0020_review_decision_signed_text.sql',
  '0021_detection_reports.sql',
  '0022_drop_go_deadline.sql',
  '0023_notify_pool_optin.sql',
  '0024_complaints.sql',
];

describe('the re-derive marker, against the real migrations (audit E-15)', () => {
  it('sees the marker in 0004, the migration that drops derived tables', () => {
    const sql = migrationSql('0004_seat_payouts.sql');
    expect(sql, 'the retrofit is in the file').to.contain(REDERIVE_MARKER);
    expect(/DROP TABLE/.test(sql), 'and 0004 really is the destructive one').to.equal(true);
    expect(declaresRederive(sql)).to.equal(true);
  });

  it('does not see it in migrations that invalidate nothing', () => {
    for (const file of [
      '0001_events_ledger.sql',
      '0003_derived_tables.sql',
      '0018_events_seq.sql',
      // R7-b: drops `pools.go_deadline`, a column no projection op ever
      // wrote. A replay would rebuild identical rows, so asking for one
      // would be an hour of work for no difference.
      '0022_drop_go_deadline.sql',
      // Notify v2 (§F): a new table the packet service owns, fed by signed
      // opt-ins rather than the ledger. Nothing derived is touched.
      '0023_notify_pool_optin.sql',
      // The complaints record (2026-09-19): a new append-only table the
      // review service owns, fed by player submissions rather than the
      // ledger. Nothing derived is touched.
      '0024_complaints.sql',
    ]) {
      expect(declaresRederive(migrationSql(file)), file).to.equal(false);
    }
  });

  it('a migration that does not mean the marker must not quote it', () => {
    // Found by this suite, not by reading the matcher: 0018 originally
    // explained in a comment that it carried NO marker — and quoted the marker
    // to say so, which declared it. The matcher reads comments, so there is no
    // way to write "not this line" in one; the file talks about the marker by
    // name instead. The cost of the false positive was one needless rebuild,
    // which is the direction the matcher is deliberately biased in, but a
    // migration that says the opposite of what it does is still wrong.
    const sql = migrationSql('0018_events_seq.sql');
    expect(sql, 'it discusses the mechanism').to.contain('RE-DERIVE MARKER');
    expect(declaresRederive(sql), 'without declaring it').to.equal(false);
  });

  it('scans the whole directory without surprises', () => {
    const marked = ALL_MIGRATIONS.filter((f) => declaresRederive(migrationSql(f)));
    // 0004 dropped two derived tables; 0019 added a column to one that only
    // a replay can fill (the sanctions holds already in the ledger). Both
    // leave a derived table that does not yet say what the events say.
    expect(marked, 'exactly the migrations that invalidate a derived table').to.deep.equal([
      '0004_seat_payouts.sql',
      '0019_sanctions.sql',
    ]);
  });
});

describe('the marker matcher, on the near-misses a migration author will write', () => {
  const cases: Array<[string, string, boolean]> = [
    ['the canonical form', `DROP TABLE results;\n${REDERIVE_MARKER}\n`, true],
    ['indented', `  \t${REDERIVE_MARKER}`, true],
    ['shouted', '-- BLOTTO-MIGRATION: REDERIVE-REQUIRED', true],
    ['no space after the dashes', '--BLOTTO-MIGRATION:rederive-required', true],
    ['trailing another statement', 'DROP TABLE results; -- BLOTTO-MIGRATION: rederive-required', true],
    ['with a note in between', '-- (see E-15) BLOTTO-MIGRATION: rederive-required', true],
    ['inside a longer comment block', `-- 0019 — something\n--\n${REDERIVE_MARKER}\n--\n-- more prose`, true],
    // The documented false positive: a comment that QUOTES the marker declares
    // it. There is no way to write "not this line" in a comment the matcher
    // reads, and the cost is one needless rebuild of tables that are a pure
    // function of the ledger — so this is the direction to be wrong in.
    ['quoted in prose, meaning the opposite', '-- never write -- BLOTTO-MIGRATION: rederive-required here', true],
    ['a space instead of the hyphen', '-- BLOTTO-MIGRATION: rederive required', false],
    ['the words alone, no marker', '-- run a re-derive after this one', false],
    ['not a comment at all', "SELECT 'BLOTTO-MIGRATION: rederive-required';", false],
    ['an empty file', '', false],
  ];

  for (const [name, sql, expected] of cases) {
    it(`${expected ? 'sees' : 'does not see'} it: ${name}`, () => {
      expect(declaresRederive(sql)).to.equal(expected);
    });
  }
});

describe('migrate() reports the invalidation to its caller', () => {
  it('returns the applied filenames and the migrations that asked for a rebuild', async () => {
    const { pool, executed } = fakePool([]);
    const run: MigrationRun = await migrate(pool);

    expect(run.applied, 'a clean database applies every migration, in order').to.deep.equal(
      ALL_MIGRATIONS
    );
    expect(run.rederiveRequestedBy).to.deep.equal([
      '0004_seat_payouts.sql',
      '0019_sanctions.sql',
    ]);
    expect(run.rederiveRequired).to.equal(true);
    // Each applied file is recorded under its own name.
    for (const file of ALL_MIGRATIONS) {
      expect(executed, file).to.contain(`recorded:${file}`);
    }
  });

  it('says nothing is required when the marked migration is already applied', async () => {
    const { pool } = fakePool(ALL_MIGRATIONS);
    const run = await migrate(pool);
    expect(run.applied).to.deep.equal([]);
    expect(run.rederiveRequestedBy).to.deep.equal([]);
    expect(run.rederiveRequired, 'an up-to-date boot must not replay the ledger').to.equal(false);
  });

  it('reports only the pending marked migration, not the history', async () => {
    // The realistic boot: everything up to 0003 is applied, and this run picks
    // up the destructive 0004 and everything after it.
    const { pool } = fakePool(ALL_MIGRATIONS.slice(0, 3));
    const run = await migrate(pool);
    expect(run.applied[0]).to.equal('0004_seat_payouts.sql');
    expect(run.applied).to.have.lengthOf(ALL_MIGRATIONS.length - 3);
    expect(run.rederiveRequestedBy).to.deep.equal([
      '0004_seat_payouts.sql',
      '0019_sanctions.sql',
    ]);
    expect(run.rederiveRequired).to.equal(true);
  });
});
