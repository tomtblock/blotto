-- 0020 — the review log serves back the EXACT timestamp text each signature
-- covers (audit 2026-09-11, A-04 / B-21), and gains the index the
-- per-reviewer action budget reads (B-25).
--
-- THE DEFECT (A-04 / B-21). A decision row is self-verifying by design: the
-- reviewer signs `canonicalReviewMessage`, which ends `at: <decidedAt>` —
-- the timestamp as a STRING, byte for byte. The log stored that instant in
-- `decided_at TIMESTAMPTZ` and reconstructed the string on read-back, in
-- `backend/detection/src/log-pg.ts`:
--
--     decidedAt: new Date(String(row.decided_at)).toISOString()
--
-- `pg` hands a TIMESTAMPTZ back as a JavaScript Date; `String(date)` formats
-- it as `Thu Aug 27 2026 12:00:00 GMT+0000 (...)`, which has no sub-second
-- field at all. Every signature's timestamp was therefore truncated to whole
-- seconds before it was served, and any row whose signed instant had
-- milliseconds — which is every row, since both clients sign
-- `new Date().toISOString()` — verified against the message it was served
-- with as FALSE. The log's whole purpose is that a published decision
-- re-checks against its own signature (CLAUDE.md tradeoff 3, verifiability);
-- nothing it served could.
--
-- THE FIX. Keep the signed text as text. `decided_at` stays for ordering and
-- for the index the appeal thread and the budget read; `decided_at_text` is
-- the exact string the signature covers and the only thing read back.
--
-- WHY BOTH COLUMNS. A TIMESTAMPTZ is an instant, not a spelling: `...:00Z`,
-- `...:00.000Z` and `...:00+00:00` are one value, and any reconstruction has
-- to guess which one was signed. The signature covers bytes, so the bytes are
-- what the log has to hold. Ordering on text would be wrong for the same
-- reason, so the instant stays too, and the service refuses any submission
-- whose timestamp is not the canonical `toISOString()` spelling — so the two
-- columns can never disagree about the same row.
--
-- THE BACKFILL IS EXACT FOR EVERY ROW OUR OWN CLIENTS WROTE. The truncation
-- happened on READ, never on write: Postgres parsed and kept the full
-- millisecond precision of whatever string was inserted. So rendering the
-- stored instant back in the canonical spelling reproduces the signed string
-- exactly, for every row signed by the admin page or the results page (both
-- sign `new Date().toISOString()`). A row signed by any other client, with a
-- different but equivalent spelling, is reconstructed as the canonical form
-- and will still not verify — that row was already unverifiable, and there is
-- no information left anywhere from which to recover its original text. After
-- this migration the tree of decisions is verifiable going forward and, for
-- our own clients, backwards as well.
--
-- THE INDEX (B-25). One reviewer key could act on any entry in any pool with
-- no bound at all. The service now counts a reviewer's own recent rows before
-- it accepts another decision, which is a `(decided_by, decided_at)` lookup;
-- the two existing indexes are both pool-first and serve it no better than a
-- sequential scan.
--
-- NO DERIVED TABLE IS TOUCHED, so this migration carries no re-derive
-- declaration (the mechanism is `REDERIVE_MARKER` in
-- backend/indexer/src/migrate.ts, and migrations/README.md describes when to
-- write it). `review_decisions` is not derived from the `events` ledger —
-- it is its own append-only record, written by the review service — so there
-- is nothing a replay could rebuild.
--
-- Forward-only. Never edit an applied migration; new schema is a
-- higher-numbered file. See migrations/README.md.

-- Nullable first: adding a column with no default is metadata-only, so the
-- table is not rewritten until the UPDATE below does it once.
ALTER TABLE review_decisions ADD COLUMN IF NOT EXISTS decided_at_text TEXT;

-- The canonical spelling: UTC, milliseconds, `Z` — exactly what
-- `Date.prototype.toISOString()` emits and therefore exactly what every
-- signature this log holds was computed over.
UPDATE review_decisions
   SET decided_at_text =
         to_char(decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE decided_at_text IS NULL;

ALTER TABLE review_decisions ALTER COLUMN decided_at_text SET NOT NULL;

-- The per-reviewer budget window (B-25): "how many decisions has this key
-- made since <instant>", asked once per submitted decision.
CREATE INDEX IF NOT EXISTS review_decisions_reviewer
  ON review_decisions (decided_by, decided_at);
