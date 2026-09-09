/**
 * The canonical attestation message (D-B4) — the exact bytes a wallet signs
 * to accept the terms + 18+ clickwrap. ONE definition, browser-bundleable:
 * the app builds it for signing, the packet service rebuilds it to verify.
 * Human-readable on purpose — wallets display the text, so the signer sees
 * exactly what is being attested. Any wording change is a new terms edition
 * by definition.
 *
 * Founder 2026-09-09: the statement no longer names a "version". The terms
 * edition is bound by its DATE instead (config/terms.json `updated`), which
 * reads the way a contract does and still changes with every edition — so
 * a bumped terms file re-prompts exactly as before (D-E2), and the stored
 * record keeps carrying the numeric version for the packet's u16 field.
 */

/** One edition of the terms, as config/terms.json declares it. */
export interface TermsEdition {
  /** Positive integer; the packet carries it as a u16. */
  version: number;
  /** ISO calendar date, `YYYY-MM-DD`, of this edition. */
  updated: string;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * `2026-09-06` → `6 September 2026`. Deterministic and locale-free, so the
 * browser and the service always produce the same bytes. Throws on anything
 * that is not a plain ISO date: a malformed config must fail closed, never
 * sign a message with "undefined" in it.
 */
export function formatTermsDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`terms date must be YYYY-MM-DD, got ${JSON.stringify(iso)}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`terms date out of range: ${iso}`);
  }
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export function attestationMessage(wallet: string, terms: TermsEdition): Uint8Array {
  if (!Number.isInteger(terms.version) || terms.version < 1) {
    throw new Error(`terms version must be a positive integer, got ${String(terms.version)}`);
  }
  return new TextEncoder().encode(
    `Blotto Cup\n` +
      `I confirm I am 18 or older and I accept the Blotto Cup terms dated ${formatTermsDate(terms.updated)}.\n` +
      `Wallet: ${wallet}\n`
  );
}
