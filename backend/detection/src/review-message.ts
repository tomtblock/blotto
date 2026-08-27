/**
 * The canonical review-decision message (C10) — in its own module with no
 * crypto import so the ADMIN PAGE can bundle it and sign byte-for-byte
 * what the review server verifies (auth.ts), the same split as the
 * attestation message in `backend/_shared`.
 */

/** The exact bytes a reviewer signs — human-readable, wallet-displayable. */
export function canonicalReviewMessage(d: {
  pool: string;
  player: string;
  action: string;
  criterion: string;
  signedAt: string;
}): Uint8Array {
  return new TextEncoder().encode(
    `Blotto Cup review decision\n` +
      `pool: ${d.pool}\n` +
      `player: ${d.player}\n` +
      `action: ${d.action}\n` +
      `criterion: ${d.criterion}\n` +
      `at: ${d.signedAt}\n`
  );
}
