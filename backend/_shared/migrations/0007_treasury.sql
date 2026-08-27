-- D-A1 (revised, master prompt v2 2026-08-27): the two-wallet pre-funded
-- treasury. Pools carry a FIXED pot, copied from Config at open_pool and
-- funded from the platform treasury before any pass sells — `PoolOpened`
-- now emits `pot_lamports` and the projection stores it here.
--
-- The treasury REPORT (GET /treasury) is deliberately NOT a derived table:
-- it is assembled at read time from the raw event ledger (like
-- /pools/:pool/verify-record), so every number a founder or player sees is
-- replayable from published events alone. This migration therefore only
-- widens `pools`.
--
-- (v2's prompt names this file 0005_treasury.sql; 0005 and 0006 were taken
-- by terms-version and review-decisions before the revision landed — the
-- next free slot is 0007. Recorded in the A1 step report.)

ALTER TABLE pools ADD COLUMN IF NOT EXISTS pot_lamports NUMERIC;
