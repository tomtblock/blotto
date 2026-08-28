-- E5 (master prompt v3): the Postgres twins the deployment mains wire in
-- place of the in-memory reference stores. All three hold data the memory
-- stores already defined; nothing here changes a contract.

-- Custody metadata for each pool's sealing key (custody-turnkey.ts:
-- PublishedKeyStore — "persist anywhere; pg in deployment wiring"). ALL
-- PUBLIC DATA: the public half, the hash the chain commits to, and the
-- Turnkey key id. The secret never exists outside Turnkey between import
-- and the post-seal export.
CREATE TABLE IF NOT EXISTS published_pool_keys (
  pool_id         NUMERIC NOT NULL PRIMARY KEY,
  public_key_hex  TEXT    NOT NULL,
  secret_hash_hex TEXT    NOT NULL,
  private_key_id  TEXT    NOT NULL
);

-- The D-B4 clickwrap records (packet/src/attestations.ts): latest per
-- wallet, signature verified before insert.
CREATE TABLE IF NOT EXISTS attestations (
  wallet           TEXT    NOT NULL PRIMARY KEY,  -- base58
  terms_version    INT     NOT NULL,
  attested_18      BOOLEAN NOT NULL,
  attested_at      NUMERIC NOT NULL,              -- unix seconds, server clock
  wallet_signature TEXT    NOT NULL               -- base64 Ed25519
);
