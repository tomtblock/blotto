/**
 * The canonical APPEAL message (Phase 2 Stage E) — the bytes a PLAYER signs
 * to lodge an appeal against an upheld flag. In its own module with no
 * crypto import, like `review-message.ts`, so the app bundles it and signs
 * byte-for-byte what the review server verifies.
 *
 * Distinct header from the review-decision message on purpose: a wallet
 * displays this text to its holder, and "Blotto Cup appeal" must never be
 * mistakable for a reviewer's decision — nor could a captured appeal
 * signature ever verify as one.
 */

/** The exact bytes an appellant signs — human-readable, wallet-displayable. */
export function canonicalAppealMessage(a: {
  pool: string;
  player: string;
  grounds: string;
  signedAt: string;
}): Uint8Array {
  return new TextEncoder().encode(
    `Blotto Cup appeal\n` +
      `pool: ${a.pool}\n` +
      `player: ${a.player}\n` +
      `grounds: ${a.grounds}\n` +
      `at: ${a.signedAt}\n`
  );
}
