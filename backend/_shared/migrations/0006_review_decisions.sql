-- C10 (D-C, 2026-08-27): the review decision log. Append-only — every
-- clear/release/forfeit/flag decision a reviewer makes, with the wallet
-- signature that authorized it, so the log is re-verifiable by anyone who
-- holds it (the row's contract is backend/detection/src/review.ts).
-- Deliberately no UNIQUE constraint beyond the id: a reversal is a NEW row
-- citing its criterion, never an overwrite of history.

CREATE TABLE review_decisions (
  id          BIGSERIAL PRIMARY KEY,
  pool        TEXT        NOT NULL, -- pool PDA, base58
  player      TEXT        NOT NULL, -- the entry's wallet, base58
  action      TEXT        NOT NULL, -- flag | clear | release | forfeit
  criterion   TEXT        NOT NULL, -- the published criterion cited
  decided_by  TEXT        NOT NULL, -- reviewer wallet (base58), the verifying key
  decided_at  TIMESTAMPTZ NOT NULL, -- the instant the signature covers
  signature   TEXT        NOT NULL  -- base64 Ed25519 over the canonical message
);

CREATE INDEX review_decisions_pool ON review_decisions (pool, decided_at);
