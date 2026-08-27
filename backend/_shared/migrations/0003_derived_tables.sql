-- Derived tables (roadmap 2.5, R15) — a pure function of the events ledger,
-- rebuilt from scratch by `rederive()`. Never written by anything except the
-- projection (backend/indexer/src/projection-pg.ts).
--
-- NUMERIC for every lamport amount and pool id: u64 exceeds BIGINT's
-- guarantee under future widening and JS 2^53 either way; amounts are bound
-- as decimal strings end-to-end.

CREATE TABLE IF NOT EXISTS pools (
  pool                 TEXT PRIMARY KEY,       -- Pool PDA, base58
  id                   NUMERIC,
  tier                 INT,
  entry_lamports       NUMERIC,
  fill_deadline        NUMERIC,
  timer_seconds        INT,
  sealing_pubkey       TEXT,                   -- hex
  sealing_secret_hash  TEXT,                   -- hex
  vrf_seed             TEXT,                   -- hex
  pass_collection      TEXT,                   -- base58
  state                TEXT,
  entrants             NUMERIC NOT NULL DEFAULT 0,
  refunded_count       NUMERIC NOT NULL DEFAULT 0,
  paid_mask            INT NOT NULL DEFAULT 0,
  secret               TEXT,                   -- hex, present after reveal
  results_root         TEXT                    -- hex
);

CREATE TABLE IF NOT EXISTS entries (
  pool           TEXT NOT NULL,
  player         TEXT NOT NULL,
  idx            INT,
  battles_hash   TEXT,
  class          INT,
  slot_hash      TEXT,
  pass_asset     TEXT,
  flagged        BOOLEAN NOT NULL DEFAULT FALSE,
  refunded       BOOLEAN NOT NULL DEFAULT FALSE,
  escrow_settled TEXT,                          -- NULL | 'released' | 'forfeited'
  PRIMARY KEY (pool, player)
);

CREATE TABLE IF NOT EXISTS results (
  pool   TEXT NOT NULL,
  rank   INT  NOT NULL,
  player TEXT NOT NULL,
  PRIMARY KEY (pool, rank)
);

CREATE TABLE IF NOT EXISTS payouts (
  pool     TEXT NOT NULL,
  rank     INT  NOT NULL,
  player   TEXT NOT NULL,
  amount   NUMERIC NOT NULL,
  escrowed BOOLEAN NOT NULL,
  PRIMARY KEY (pool, rank)
);

-- R15: lifetime, read-only profile projection. Nothing on it can affect a
-- pool. class_0..class_4 mirror the fixed class order (Goblin..Titan).
CREATE TABLE IF NOT EXISTS profiles (
  player            TEXT PRIMARY KEY,
  pools_entered     NUMERIC NOT NULL DEFAULT 0,
  ranks_paid        NUMERIC NOT NULL DEFAULT 0,
  total_won_lamports NUMERIC NOT NULL DEFAULT 0,
  best_rank         INT,
  class_0           NUMERIC NOT NULL DEFAULT 0,
  class_1           NUMERIC NOT NULL DEFAULT 0,
  class_2           NUMERIC NOT NULL DEFAULT 0,
  class_3           NUMERIC NOT NULL DEFAULT 0,
  class_4           NUMERIC NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS entries_player_idx ON entries (player);
CREATE INDEX IF NOT EXISTS payouts_player_idx ON payouts (player);
