-- The complaints route (2026-09-19): the way a player contests anything.
--
-- Until this change there was nowhere for a player to complain — copy said
-- "tell us" and led nowhere — and the published appeal right could not be
-- exercised, because it promised a different reviewer and the registry holds
-- one person. The named reviewer comes out of the player-facing product and
-- this replaces it as the route to challenge a decision.
--
-- APPEND-ONLY, like review_decisions (0006). One row per EVENT in a
-- complaint's life: the player's `lodged`, then the operator's
-- `acknowledged` and `resolved`. There is no status column to mutate and no
-- UNIQUE constraint beyond the id — an operator updating a status APPENDS,
-- so the history of a complaint cannot be quietly rewritten, and the status
-- a player is shown is derived from the thread
-- (backend/detection/src/complaints.ts::complaintStatus).
--
-- The row's contract is that module. Nothing here can move a lamport.
--
-- ON `wallet` BEING NULLABLE. A wallet signature is required for anything
-- that asks us to change an outcome, and optional otherwise, so a player
-- locked out of their wallet can still reach us. An unsigned submission
-- records NO address: it would be unproven, and holding unproven personal
-- data for nothing is what the 2026-09-15 data-minimisation ruling forbids.
--
-- `signed_at` is TEXT and holds the exact string the signature covers — the
-- A-04/B-21 lesson from migration 0020: a TIMESTAMPTZ round-trip truncates
-- sub-second digits and no row then re-verifies against its own signature.
--
-- ON `decided_by`. The terms undertake that a challenge is answered "by
-- someone other than whoever made the original one wherever that is
-- possible". The predecessor of that sentence was a RULE, enforced by a
-- check that refused the upholding reviewer, and with one person in the
-- registry it made the right unexercisable (audit O24) — which is why the
-- rule is gone. What replaces enforcement is RECORD: the original decision
-- already carries its `decided_by` (review_decisions, 0006), and an
-- operator's row here carries whose key answered, so whether a different
-- person answered is checkable after the fact from two append-only tables
-- rather than asserted. A promise that cannot be enforced up front can at
-- least be made falsifiable; an undertaking whose keeping leaves no trace
-- is the defect this repository has been bitten by five times.

CREATE TABLE complaints (
  id          BIGSERIAL   PRIMARY KEY,
  reference   TEXT        NOT NULL, -- the player's handle, BC-XXXXXXXX, inside the signed bytes
  kind        TEXT        NOT NULL, -- lodged | acknowledged | resolved
  wallet      TEXT,                 -- base58; NULL on an unsigned submission
  category    TEXT        NOT NULL, -- decision | payment | site | data_protection | other
  pool        TEXT,                 -- pool PDA, base58, when the complaint is about one
  body        TEXT        NOT NULL, -- the player's own words on `lodged`; the operator's note otherwise
  signature   TEXT,                 -- base64 Ed25519 over the canonical message; NULL when unsigned
  signed_at   TEXT,                 -- the exact instant string the signature covers
  decided_by  TEXT,                 -- base58 registry key that answered; NULL on `lodged`
  received_at TIMESTAMPTZ NOT NULL  -- the service's clock
);

-- The one read: every row for one reference, oldest first.
CREATE INDEX complaints_reference ON complaints (reference, id);

-- The operator's queue: what is still open, newest first. Partial, because a
-- resolved complaint is not the desk's problem.
CREATE INDEX complaints_open ON complaints (received_at DESC) WHERE kind = 'lodged';
