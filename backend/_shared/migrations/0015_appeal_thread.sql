-- Phase 2 Stage E (2026-09-07): appeals in the review log.
--
-- Three more values in review_decisions.action — appeal_lodged (signed by
-- the PLAYER over the appeal message; decided_by is the appellant's wallet
-- and criterion carries the grounds), appeal_upheld and appeal_dismissed
-- (signed by a reviewer other than the one who upheld the flag). The
-- column never carried a CHECK, by design (0006: a reversal is a new row);
-- the row's meaning per action is backend/detection/src/review.ts.
--
-- The appeal rules read one ENTRY's thread — every row for (pool, player),
-- oldest first — which the existing (pool, decided_at) index does not
-- serve once a pool has many decided entries. Additive only (house rule).

CREATE INDEX IF NOT EXISTS review_decisions_entry
  ON review_decisions (pool, player, decided_at, id);
