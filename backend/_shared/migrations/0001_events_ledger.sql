-- 0001 — the generic event ledger.
--
-- The ONLY table Phase 0 creates. The predecessor's first migration also created
-- four derived tables; every one of them described that product and none was
-- carried. Phase 2 adds this product's derived tables in higher-numbered files,
-- driven by the TECH-ARCH §3.3 event list.
--
-- The ledger is the source of truth and derived tables are a pure function of it.
-- That is not a stylistic preference: TECH-ARCH §1 states that the backend
-- publishes everything needed to recompute what it computed, and a derived table
-- that cannot be rebuilt from this table alone has quietly become a second source
-- of truth. `re-derive` exists to keep that honest.
--
-- Forward-only. Never edit an applied migration; new schema is a higher-numbered
-- file. See migrations/README.md.

CREATE TABLE IF NOT EXISTS events (
  -- The transaction signature, base58.
  signature   TEXT     NOT NULL,
  -- The event's ordinal among ALL `Program data:` lines in that transaction —
  -- including lines from other programs, so the index never shifts as decoder
  -- coverage grows. Together with `signature` this is the idempotency key, and it
  -- is what makes a webhook redelivery and a backfill walk converge on one row.
  event_index INTEGER  NOT NULL,
  -- Slot the transaction landed in. NUMERIC, not BIGINT: slot fits in a signed
  -- 64-bit integer today, but every other on-chain quantity in this schema is
  -- NUMERIC for u64 range, and one consistent rule is worth more than one saved
  -- byte.
  slot        NUMERIC  NOT NULL,
  -- The emitting program, base58. Recorded per row rather than assumed, so a
  -- ledger that ever ingests from more than one program stays unambiguous.
  program     TEXT     NOT NULL,
  -- The event name, from the decoded discriminator.
  name        TEXT     NOT NULL,
  -- The decoded event, with every u64 as a decimal STRING. Never a float: JSON
  -- cannot represent u64 precisely as a number, and a prize amount rounded by a
  -- float is a payment bug.
  raw         JSONB    NOT NULL,
  -- The commitment the row was ingested at ('finalized' or 'confirmed').
  commitment  TEXT     NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Idempotency at the storage layer. The application checks too; both are
  -- deliberate — the application check keeps the common redelivery cheap, this
  -- constraint makes a race impossible.
  PRIMARY KEY (signature, event_index)
);

-- The ingest watermark (MAX(slot)) and the ordered replay a re-derive performs.
CREATE INDEX IF NOT EXISTS events_slot_idx ON events (slot);

-- Reading every occurrence of one event type across a pool's life — the shape
-- every derived table and every verification read will use.
CREATE INDEX IF NOT EXISTS events_name_slot_idx ON events (name, slot);
