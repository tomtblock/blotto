-- v3 D3: the email-notification opt-in record — the wallet's own signed
-- choice, latest per wallet (backend/packet/src/notify.ts). The email
-- ADDRESS is deliberately not stored: the sign-in provider holds it, and
-- the dispatch job resolves it at send time. Signature verified before
-- insert; `signed_at` is the timestamp FROM the signed message, so an older
-- captured message can never overwrite a newer choice.

CREATE TABLE IF NOT EXISTS notify_optin (
  wallet            TEXT        NOT NULL PRIMARY KEY,  -- base58
  email_opt_in      BOOLEAN     NOT NULL,
  signed_at         NUMERIC     NOT NULL,              -- unix seconds, from the message
  wallet_signature  TEXT        NOT NULL,              -- base64 Ed25519
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
