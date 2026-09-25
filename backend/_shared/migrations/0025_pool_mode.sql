-- Phase B (founder rulings 2026-09-24): the two board modes.
--
--   * `pools.mode` — the placing rule the pool was opened under, from
--     `PoolOpened.mode` (0 easy, 1 hard). Every pool projected before this
--     migration played easy: hard did not exist, and the event's appended
--     byte is absent on those, so the DEFAULT is the truth, not a guess.
--   * `tier_status.mode` — the cooldown stamp is per LADDER now: the easy
--     and hard ladders keep separate slots and clocks per tier
--     (`TierSlotFreed.mode`), so the row's key becomes (tier, mode). Every
--     existing row is the easy ladder's.
--
-- Additive only (house rule: forward-only migrations, no edits to applied
-- files); the primary-key change keeps every row and is the one structural
-- edit a per-mode stamp cannot do without. The projection is rederived
-- after this migration so `mode` is filled from the ledger rather than
-- left at the default for pools opened after the upgrade.
--
-- BLOTTO-MIGRATION: rederive-required

ALTER TABLE pools ADD COLUMN IF NOT EXISTS mode SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE tier_status ADD COLUMN IF NOT EXISTS mode SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE tier_status DROP CONSTRAINT IF EXISTS tier_status_pkey;
ALTER TABLE tier_status ADD PRIMARY KEY (tier, mode);
