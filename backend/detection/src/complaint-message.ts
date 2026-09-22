/**
 * The canonical COMPLAINT message (2026-09-19) — the bytes a player signs to
 * lodge a complaint. In its own module with no crypto import, like
 * `appeal-message.ts` and `review-message.ts`, so the app bundles it and
 * signs byte-for-byte what the review service verifies. The two ends cannot
 * drift, because there is one definition.
 *
 * Distinct header from the appeal and review messages on purpose: a wallet
 * displays this text to its holder, and "Blotto Cup complaint" must never be
 * mistakable for a reviewer's decision — nor could a captured complaint
 * signature ever verify as one.
 *
 * THE REFERENCE IS INSIDE THE SIGNED BYTES. The client chooses it and signs
 * it, so a player can prove afterwards exactly which complaint they lodged
 * and when; a server-minted reference would sit outside the signature and
 * prove nothing. `pool` is optional — most categories have no pool — and
 * appears as a literal `-` when absent, so a complaint about no pool and a
 * complaint about a pool called "-" cannot collide.
 */

/** The reference shape, chosen by the client: BC- plus eight of 23456789ABCDEFGHJKLMNPQRSTUVWXYZ. */
export const COMPLAINT_REFERENCE_PATTERN = /^BC-[2-9A-HJ-NP-Z]{8}$/;

/** The alphabet a reference is drawn from — no 0/O/1/I, so it can be read aloud. */
export const COMPLAINT_REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** The exact bytes a complainant signs — human-readable, wallet-displayable. */
export function canonicalComplaintMessage(c: {
  reference: string;
  wallet: string;
  category: string;
  /** The pool the complaint is about, or null/undefined when it is about none. */
  pool?: string | null;
  text: string;
  signedAt: string;
}): Uint8Array {
  return new TextEncoder().encode(
    `Blotto Cup complaint\n` +
      `reference: ${c.reference}\n` +
      `wallet: ${c.wallet}\n` +
      `category: ${c.category}\n` +
      `pool: ${c.pool ?? '-'}\n` +
      `text: ${c.text}\n` +
      `at: ${c.signedAt}\n`
  );
}

/**
 * The exact bytes an OPERATOR signs to move a complaint's status on
 * (2026-09-22). Distinct header again, and for the same reason the player's
 * message has one: a wallet displays this text, and a captured complaint
 * signature must never verify as a status update — nor a status update as a
 * review decision. Three headers, three non-interchangeable signatures.
 *
 * The NOTE is inside the signed bytes because the player is shown it. A note
 * that sat outside the signature could be changed by anyone who could write
 * to the store, and the row would still verify — which would make
 * `decidedBy` a claim about who wrote *something*, not about who wrote
 * *this*.
 */
export function canonicalComplaintStatusMessage(c: {
  reference: string;
  /** `acknowledged` or `resolved` — the kind of row being appended. */
  status: string;
  /** The operator's note to the player. */
  note: string;
  signedAt: string;
}): Uint8Array {
  return new TextEncoder().encode(
    `Blotto Cup complaint status\n` +
      `reference: ${c.reference}\n` +
      `status: ${c.status}\n` +
      `note: ${c.note}\n` +
      `at: ${c.signedAt}\n`
  );
}
