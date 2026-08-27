-- D-B4 (ratified 2026-08-27): every entry ties to the terms/attestation
-- version its verified packet carried; EntryRegistered now emits it and the
-- projection stores it. Rebuildable from the ledger (rederive) like every
-- derived column.

ALTER TABLE entries ADD COLUMN IF NOT EXISTS terms_version INT;
