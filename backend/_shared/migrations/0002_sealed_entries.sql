-- Ciphertext store (roadmap 2.3; TECH-ARCH §5). CIPHERTEXT ONLY — there is
-- no plaintext column and no code path that could fill one before the pool
-- secret is exported post-seal. See backend/sealing/src/store.ts.
CREATE TABLE IF NOT EXISTS sealed_entries (
  pool_id     NUMERIC      NOT NULL,
  player      TEXT         NOT NULL,
  ciphertext  BYTEA        NOT NULL,
  received_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (pool_id, player)
);
