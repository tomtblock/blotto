-- D-E4 (proposal E1 §11, ratified 2026-09-06): the minimum-field go-timer.
-- The 52nd entry shortens the pool's effective deadline on-chain by
-- rewriting `fill_deadline` in place (no new account field — proposal
-- option B stored as B′) and emits `GoTimerStarted { pool, go_deadline }`.
-- The projection mirrors that: `pools.fill_deadline` becomes the go
-- deadline (so every "deadline" reader keeps reading the effective one) and
-- `pools.go_deadline` records that the timer started and when, which is
-- what the app's countdown label keys on. NULL until the timer starts.
--
-- Additive only (house rule: forward-only migrations, no edits to applied
-- files). NUMERIC like every other on-chain quantity (0003's rule).

ALTER TABLE pools ADD COLUMN IF NOT EXISTS go_deadline NUMERIC;
