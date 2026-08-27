-- D-A2 as amended by master prompt v2 (2026-08-27): the player-history
-- derived table — one row per (pool, player) entry, carrying the player's
-- running entry count at that moment and the payout outcome. The Gate 3
-- exhibit's read-API endpoints (first-time vs repeat paid-seat rate, paid
-- persistence across consecutive entries, entries-to-date distribution)
-- compute over these rows. No PII beyond the wallet address, by design.
--
-- Like every derived table this is a pure function of the event ledger
-- (rebuilt by rederive()); `entries_to_date` is the profiles counter AS OF
-- the entry's own event, so replay order reproduces it exactly.

CREATE TABLE IF NOT EXISTS player_history (
  player           TEXT NOT NULL,               -- wallet, base58
  pool             TEXT NOT NULL,               -- Pool PDA, base58
  tier             INT,
  seat             INT,
  entries_to_date  NUMERIC NOT NULL DEFAULT 0,  -- this entry is the player's Nth
  paid             BOOLEAN NOT NULL DEFAULT FALSE,
  amount_lamports  NUMERIC NOT NULL DEFAULT 0,  -- committed payout (escrowed included)
  pot_lamports     NUMERIC,                     -- the pool's fixed pot (for the share)
  PRIMARY KEY (pool, player)
);

CREATE INDEX IF NOT EXISTS player_history_player_idx
  ON player_history (player, entries_to_date);
