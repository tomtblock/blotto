-- D3-B (ratified 2026-08-27, step tiers-and-ties): payouts are committed per
-- SEAT, not per rank — tied players share a competition rank and split the
-- combined band prize, so the paid set can exceed 16 rows and rank labels
-- are no longer in the events (they live in the published bundle; the verify
-- page recomputes them). `results` and `payouts` re-key on (pool, seat).
--
-- Derived tables are a pure function of the events ledger (0003's contract),
-- so DROP + recreate + `rederive()` loses nothing.
--
-- RETROFIT, 2026-09-12 (audit E-15). The line below used to read "Run a
-- re-derive after applying this migration." — an instruction addressed to a
-- human that nothing in the code read, so a boot that applied this migration
-- served seven empty derived tables until someone noticed. The marker is the
-- machine-readable form of the same statement: `migrate()` reports it and the
-- boot path chains the rebuild (backend/indexer/src/migrate.ts).
--
-- This is a COMMENT-ONLY change to a migration that is already applied
-- everywhere, and it is the one edit the forward-only rule permits: the SQL
-- below is untouched, so this file still produces exactly the schema it
-- produced before, and it is recorded in `schema_migrations` on every
-- database that has run it, so it will never be applied again. The marker
-- here is a statement of intent for the reader — it is the pattern migration
-- 0019 should copy — not a request to re-run anything.

-- BLOTTO-MIGRATION: rederive-required

DROP TABLE IF EXISTS results;
DROP TABLE IF EXISTS payouts;

-- The committed payout list (from ResultsCommitted): seat → amount.
CREATE TABLE results (
  pool   TEXT NOT NULL,
  seat   INT  NOT NULL,     -- entry index, 0-based
  amount NUMERIC NOT NULL,  -- committed split-pot lamports
  PRIMARY KEY (pool, seat)
);

-- Settled seats (from PrizesPaid): who received (or escrowed) what.
CREATE TABLE payouts (
  pool     TEXT NOT NULL,
  seat     INT  NOT NULL,
  player   TEXT NOT NULL,
  amount   NUMERIC NOT NULL,
  escrowed BOOLEAN NOT NULL,
  PRIMARY KEY (pool, seat)
);

CREATE INDEX IF NOT EXISTS payouts_player_idx ON payouts (player);

-- paid_mask is a u64 seat bitmask now — INT cannot hold it.
ALTER TABLE pools ALTER COLUMN paid_mask TYPE NUMERIC;

-- Profile: rank labels left the events, so best_rank cannot be projected;
-- ranks_paid becomes seats_paid (a count of settled prize shares).
ALTER TABLE profiles DROP COLUMN IF EXISTS best_rank;
ALTER TABLE profiles RENAME COLUMN ranks_paid TO seats_paid;
