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

/**
 * The exact bytes the OPERATOR signs to answer a complaint (2026-09-22).
 *
 * A distinct header again, for the same reason and one more: this is the
 * only signature in the system that a player never makes, and it must not
 * be producible by replaying anything a player did sign. A captured lodge
 * signature cannot verify as an answer, and an answer cannot verify as a
 * lodge, a decision or an appeal.
 *
 * WHY THE ANSWER IS SIGNED AT ALL. The terms undertake that a challenge is
 * answered "by someone other than whoever made the original one wherever
 * that is possible". Nothing enforces the difference — the predecessor rule
 * did, and a one-member registry made the right it protected unexercisable
 * (audit O24) — so the record IS the mechanism, and a record is only worth
 * something if the name on it was proved rather than typed. The signature is
 * what makes `decided_by` evidence instead of an assertion.
 *
 * The note is inside the signed bytes because it is what the player is
 * shown. An operator who could change the note after signing could answer
 * one thing and publish another.
 */
export function canonicalComplaintAnswerMessage(a: {
  reference: string;
  /** `acknowledged` or `resolved`. */
  kind: string;
  /** The registry key answering — base58. */
  decidedBy: string;
  /** What the player is told. */
  note: string;
  signedAt: string;
}): Uint8Array {
  return new TextEncoder().encode(
    `Blotto Cup complaint answer\n` +
      `reference: ${a.reference}\n` +
      `kind: ${a.kind}\n` +
      `by: ${a.decidedBy}\n` +
      `note: ${a.note}\n` +
      `at: ${a.signedAt}\n`
  );
}

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
