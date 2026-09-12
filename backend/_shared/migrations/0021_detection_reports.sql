-- 0021 — the detection report store (audit 2026-09-11, A-18 / D-36;
-- founder ruling D-E9, 2026-09-12).
--
-- WHAT D-E9 RATIFIED. Detection stays MANUAL: no signal takes an automatic
-- action, and `Config.detection_hard_block` is not consulted by anything
-- off-chain. What changes is that every report is PERSISTED and surfaced to
-- the reviewer before the review window closes. Until now the five signals
-- ran on every settled pool and their report went to standard output, only
-- when it had findings — so a finding reached a human only if someone was
-- reading the daemon's log at the time, and nothing was left afterwards to
-- read at all.
--
-- THE ROW. One row per RUN, not one per pool: the crank can re-run detection
-- on a pool it retries, and this table follows the same append-only
-- discipline as `review_decisions` (0006) — a later run is a new row, never
-- an overwrite of what an earlier one said. The reviewer surface serves the
-- most recent row for a pool; the history stays for anyone asking why a
-- recommendation changed.
--
-- `findings` is the signal output verbatim (`Finding[]` in
-- backend/detection/src/signals.ts) as `jsonb`, so a threshold change that
-- alters the shape needs no migration and an old row still reads back as
-- what that run actually said. `review_recommended` and `hard_blocks` are
-- the pipeline's two player lists, stored separately because they are what
-- the surface filters and sorts on — not derivable from `findings` without
-- re-running the pipeline's own rules.
--
-- NOT PUBLIC. These rows name players a signal fired on, before any human
-- has looked. The service serves them only to an operator-token caller
-- (backend/detection/src/server.ts, `GET /detection`); nothing on the player
-- side reads this table.
--
-- NO DERIVED TABLE IS TOUCHED, so this migration carries no re-derive
-- declaration (`REDERIVE_MARKER` in backend/indexer/src/migrate.ts, and
-- migrations/README.md for when one is due). This table is written by the
-- settlement daemon from revealed pool data, not projected from the `events`
-- ledger, so a replay could not rebuild it.
--
-- Forward-only. Never edit an applied migration; new schema is a
-- higher-numbered file. See migrations/README.md.

CREATE TABLE IF NOT EXISTS detection_reports (
  id                 BIGSERIAL   PRIMARY KEY,
  pool               TEXT        NOT NULL, -- pool PDA, base58 (the key every review surface uses)
  pool_id            NUMERIC     NOT NULL, -- the u64 pool id the daemon ran under
  produced_at        TIMESTAMPTZ NOT NULL, -- when the pipeline ran
  findings           JSONB       NOT NULL, -- Finding[] verbatim
  review_recommended JSONB       NOT NULL, -- base58 wallets: two independent signals
  hard_blocks        JSONB       NOT NULL  -- base58 wallets: R11's two conclusive signals
);

-- The one query the reviewer surface makes: the latest run for a pool.
CREATE INDEX IF NOT EXISTS detection_reports_pool
  ON detection_reports (pool, produced_at DESC, id DESC);
