-- The Ladder (D-E19, founder ruling 2026-11-04, confirmed 2026-11-05): four
-- pool sizes, the top quarter paid on a fixed table, one pool TYPE per
-- (mode, tier, capacity).
--
--   * `pools.capacity`, `pools.min_seats`, `pools.paid_places`,
--     `pools.prize_table` — what the pool was opened under, from the tail
--     `PoolOpened` gained (and from `PoolMigrated`'s, for a pool grown to
--     the Ladder layout). A pre-Ladder event carries none of them and the
--     projection writes the rule those pools played by: 64 seats, one paid
--     place worth the whole prize pool in whole entries (`preLadderTable`
--     in `backend/_shared/src/pool-account.ts`, the program's own
--     `migrate_pool` rule). `min_seats` is NULL until an event states it:
--     a pre-Ladder `PoolOpened` does not carry it, and `PoolMigrated`
--     always does. `prize_table` holds `paid_places` entries — whole
--     multiples of the entry, rank 1 first — never the zero padding.
--   * `pool_types` — one row per (mode, tier, capacity), projected from
--     `PoolTypeInitialized`, `PoolTypeEconomicsSet`, `PoolTypeEnabledSet`
--     and `TierSlotFreed` (the cooldown stamp and the pool that freed the
--     slot). The read API's ledger fallback for GET /pool-types and the
--     treasury report's per-pool-type policy when the chain read fails.
--   * `tier_status` — re-keyed (tier, mode, capacity): since D-E19 the slot
--     a `TierSlotFreed` frees is the pool TYPE's. Every existing row is the
--     64-player slot, the only size there was, so the DEFAULT is the truth.
--     GET /tiers keeps serving it (the 64-player rows) for older readers.
--
-- Additive only (house rule: forward-only migrations, no edits to applied
-- files); the primary-key change keeps every row. SMALLINT for the small
-- on-chain integers (u8 / u16), NUMERIC for every lamport amount and pool id
-- (0003's rule). The projection is rederived after this migration so every
-- pool row carries its size and table from the ledger rather than the
-- column defaults, and `pool_types` is filled from events already ingested.
--
-- BLOTTO-MIGRATION: rederive-required

ALTER TABLE pools ADD COLUMN IF NOT EXISTS capacity SMALLINT NOT NULL DEFAULT 64;
ALTER TABLE pools ADD COLUMN IF NOT EXISTS min_seats SMALLINT;
ALTER TABLE pools ADD COLUMN IF NOT EXISTS paid_places SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE pools ADD COLUMN IF NOT EXISTS prize_table SMALLINT[];

CREATE TABLE IF NOT EXISTS pool_types (
  mode         SMALLINT NOT NULL,             -- 0 easy, 1 hard
  tier         SMALLINT NOT NULL,             -- 0..6
  capacity     SMALLINT NOT NULL,             -- 8, 16, 32, 64
  pool_type    TEXT,                          -- PoolType PDA, base58; NULL for a slot stamp with no PoolType event
  min_seats    SMALLINT,
  paid_places  SMALLINT,
  prize_table  SMALLINT[],                    -- paid_places entries, rank 1 first
  pot_lamports NUMERIC,                       -- the FIXED prize pool the next pool of the type opens with
  enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  next_open_at NUMERIC NOT NULL DEFAULT 0,    -- unix seconds; 0 = never settled a pool
  last_pool_id NUMERIC,
  PRIMARY KEY (mode, tier, capacity)
);

ALTER TABLE tier_status ADD COLUMN IF NOT EXISTS capacity SMALLINT NOT NULL DEFAULT 64;
ALTER TABLE tier_status DROP CONSTRAINT IF EXISTS tier_status_pkey;
ALTER TABLE tier_status ADD PRIMARY KEY (tier, mode, capacity);
