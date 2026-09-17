-- Round four (founder 2026-09-17, CHANGE-2026-09-16_ui-uplift.md §F): the
-- one-message opt-in, v2 — PER POOL, WITH the address, the wallet's signed
-- consent over all of it (backend/packet/src/notify-pool.ts). v1
-- (0009_notify_optin) stored a per-wallet flag and no address, on the
-- assumption the sign-in provider would supply one at send time, and
-- nothing ever sent. It stays, dormant: deleting a validly signed record is
-- the worse of the two mistakes.
--
-- The address lives here only until the message goes: the dispatcher sets
-- sent_at and NULLs email in one statement, so what remains afterwards is
-- the fact that a message went, never where to. A row is one wallet's
-- choice for one pool; a newer signed message replaces an older one and
-- reopens it.

CREATE TABLE IF NOT EXISTS notify_pool_optin (
  pool              TEXT        NOT NULL,              -- pool PDA, base58
  wallet            TEXT        NOT NULL,              -- base58
  email             TEXT,                              -- NULL once sent
  signed_at         NUMERIC     NOT NULL,              -- unix seconds, from the message
  wallet_signature  TEXT        NOT NULL,              -- base64 Ed25519
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at           TIMESTAMPTZ,
  PRIMARY KEY (pool, wallet)
);

-- The dispatcher's read: what is still to send.
CREATE INDEX IF NOT EXISTS notify_pool_optin_pending
  ON notify_pool_optin (received_at)
  WHERE sent_at IS NULL;
