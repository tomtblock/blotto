-- E3 (proposal E1 §4): the pool archive — a VERIFIED CACHE of the
-- published bundle, never an authority. `rankings` holds the full
-- per-seat ranking for a settled pool; `bundles` records where it came
-- from and whether the locally recomputed Merkle root matched the
-- on-chain `results_root`. root_matches is STORED, not assumed: a false
-- row is a loud incident, and the read API never serves rankings for a
-- pool whose bundle did not verify.
--
-- Additive only (house rule: forward-only migrations, no edits to
-- applied files). NUMERIC for every lamport amount (0003's rule: u64
-- exceeds BIGINT under widening and JS 2^53 either way).

CREATE TABLE IF NOT EXISTS rankings (
  pool            TEXT    NOT NULL,
  seat            INT     NOT NULL,
  player          TEXT    NOT NULL,
  rank            INT     NOT NULL,
  score_half      INT     NOT NULL,
  zones           INT     NOT NULL,
  amount_lamports NUMERIC NOT NULL,
  PRIMARY KEY (pool, seat)
);
CREATE INDEX IF NOT EXISTS rankings_by_rank ON rankings (pool, rank);
CREATE INDEX IF NOT EXISTS rankings_by_player ON rankings (player);

CREATE TABLE IF NOT EXISTS bundles (
  pool         TEXT PRIMARY KEY,
  uri          TEXT NOT NULL,
  results_root TEXT NOT NULL,        -- hex, as recomputed locally
  verified_at  TIMESTAMPTZ NOT NULL,
  root_matches BOOLEAN NOT NULL
);
