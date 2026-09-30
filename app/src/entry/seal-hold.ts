/*
 * What holds the seal key back, beyond the board itself (founder
 * 2026-09-30: the entry is ONE view — the board, "How this pool…", the two
 * statements and the one gold key — and the key is the last thing pressed
 * before the wallet).
 *
 * The board decides whether its seven fields are full. THIS decides the
 * rest: a wallet with no acceptance of the current terms on record must
 * confirm both statements (D-B4) before the key lights. A wallet whose
 * acceptance is on record is asked nothing. Pure, so the rule is pinned by
 * a test rather than read off a screen.
 */

export interface SealHoldInput {
  /** The device has this wallet's acceptance of the current terms on record. */
  attested: boolean;
  /** The 18+ statement, confirmed on this page. */
  ageChecked: boolean;
  /** The terms statement, confirmed on this page. */
  termsChecked: boolean;
}

/** Why the seal waits, or null when the statements are satisfied. */
export type SealHold = 'statements' | null;

export function sealHold({ attested, ageChecked, termsChecked }: SealHoldInput): SealHold {
  if (attested) return null;
  return ageChecked && termsChecked ? null : 'statements';
}

/**
 * Whether the seal press must FIRST have the wallet sign the statements:
 * true exactly when the statements were confirmed here rather than found
 * on record. The signature is the acceptance (attestation.ts); ticking the
 * tiles records nothing by itself.
 */
export function needsAttestation(input: SealHoldInput): boolean {
  return !input.attested && sealHold(input) === null;
}
