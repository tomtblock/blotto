-- 2026-09-12 (audit 2026-09-11: B-07 / D-28 / F-06 / C-25; founder ruling
-- D-E8 in docs/BUILD-ROADMAP_v1.0.md §1.2).
--
-- `rankings` was keyed on the SEAT the published bundle claimed, and served
-- that seat, the battle score and the zone count under the same "verified"
-- label as the prize. The on-chain results root commits to
-- `player ‖ rank ‖ amount` and nothing else (backend/scoring/src/merkle.ts),
-- so three of those five columns were never covered by the check the label
-- refers to — and `seat` came verbatim from the uploaded file, which is the
-- one place a forger controls.
--
-- The ruling: the archive presents as verified only what the root covers.
-- So the row's identity becomes the PLAYER, which the root does commit, and
-- `seat` becomes a NULLABLE column filled from `entries.idx` — our own
-- projection of the on-chain `EntryRegistered` event. Null means our ledger
-- has no entry row for that player yet (a missed delivery, which the
-- reconciliation work tracks separately); it is not a reason to withhold a
-- prize row whose player, rank and amount did verify.
--
-- Non-destructive on purpose: the rows survive the re-key, so no re-derive
-- and no archive backfill is needed to serve again after this applies. The
-- duplicate sweep below is a guard, not an expectation — a published bundle
-- naming one player twice would have inserted two rows under the old key,
-- and `ingestBundle` now refuses such a bundle outright.

-- One row per (pool, player) before the key demands it. `ctid` is the
-- physical row identity; keeping the lowest is arbitrary and safe, because
-- the ingest that follows replaces every row for the pool anyway.
DELETE FROM rankings a
 USING rankings b
 WHERE a.pool = b.pool
   AND a.player = b.player
   AND a.ctid > b.ctid;

ALTER TABLE rankings DROP CONSTRAINT IF EXISTS rankings_pkey;
ALTER TABLE rankings ALTER COLUMN seat DROP NOT NULL;
ALTER TABLE rankings ADD CONSTRAINT rankings_pkey PRIMARY KEY (pool, player);

-- The career endpoint joins a player's history to their archived rank; the
-- seat lookup keeps its own index now that it is no longer the key.
CREATE INDEX IF NOT EXISTS rankings_by_seat ON rankings (pool, seat);
