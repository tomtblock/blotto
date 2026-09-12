-- 2026-09-12 (audit 2026-09-11, C-09 / B-32 / D-27): the daemon's own record
-- of which settled pools have a published reveal bundle, and where.
--
-- Until now the crank published and forgot: nothing it could read said "this
-- pool's bundle is already on Irys", so a resumed settlement uploaded again
-- (a second permanent, billed object), and a pool whose publish FAILED was
-- never retried at all — the sweep treats Paid as terminal and the archive's
-- backfill can only discover an upload that happened. One row per pool,
-- written right after a successful upload; the daemon consults it before
-- publishing and treats a Paid pool without a row as still owing its bundle.
--
-- ALL PUBLIC DATA (the URI is the published object's address). Additive only.
CREATE TABLE IF NOT EXISTS published_bundles (
  pool_id      NUMERIC NOT NULL PRIMARY KEY,
  uri          TEXT    NOT NULL,
  published_at NUMERIC NOT NULL   -- unix seconds, the daemon's clock
);
