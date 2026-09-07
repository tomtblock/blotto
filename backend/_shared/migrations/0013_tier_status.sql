-- The 2026-09-07 upgrade (prompt v2 §B.6, §E; founder rulings 2026-09-07):
--
--   * `tier_status` — one row per tier, written from `TierSlotFreed`: the
--     unix second the tier's next pool may open (its cooldown stamp) and
--     the pool that freed the slot. The app's "next pool in" countdown
--     reads this; a tier with no row never settled a pool.
--   * `entries.next_place_lamports` — lamports an entry received from a
--     forfeited share (`NextPlacePaid`, one portion per event), on top of
--     any committed payout.
--
-- `pools.go_deadline` (0012) stays as a column and is simply never written
-- again: the go-timer was removed before any deployment emitted it.
--
-- Additive only (house rule: forward-only migrations, no edits to applied
-- files). NUMERIC for every on-chain quantity (0003's rule).

CREATE TABLE IF NOT EXISTS tier_status (
  tier         INT     PRIMARY KEY,
  next_open_at NUMERIC NOT NULL DEFAULT 0,
  last_pool_id NUMERIC
);

ALTER TABLE entries ADD COLUMN IF NOT EXISTS next_place_lamports NUMERIC NOT NULL DEFAULT 0;
