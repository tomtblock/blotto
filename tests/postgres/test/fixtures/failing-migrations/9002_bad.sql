-- A migration that creates a table and THEN fails, so the only way its table
-- can be absent afterwards is a rollback. If the runner ever stopped wrapping
-- each file in a transaction, `migration_probe_bad` would survive this and
-- `migrations.spec.ts` would say so.
CREATE TABLE migration_probe_bad (
  id INT PRIMARY KEY
);

-- Invalid on purpose: there is no such column, and the error is raised at
-- execution time rather than at parse time of the first statement.
INSERT INTO migration_probe_bad (no_such_column) VALUES (1);
