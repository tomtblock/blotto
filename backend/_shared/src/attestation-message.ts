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
 *
 * BECAUSE the date is what the signer sees and the version is what the
 * record stores, the two must identify each other exactly (audit
 * 2026-09-11, B-44). If two editions ever shared a date, a signature
 * captured for the older one would verify byte-for-byte for the newer, and
 * the service would store it as consent to terms that signer never saw.
 * `assertEditionLedger` below is what makes that impossible: the committed
 * ledger of editions is checked at boot, and a date that does not move
 * forward fails the service closed rather than accepting an ambiguous
 * consent record. Changing the statement to name the version instead would
 * also close it, but the wording is founder-owned and dated, so the
 * invariant is enforced around it rather than by rewriting it.
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

/**
 * The committed history of terms editions, oldest first, as
 * `config/terms.json` declares it. Append-only: an edition that has been
 * published has been signed by real wallets, and removing or renumbering it
 * would orphan those consent records.
 */
export type TermsLedger = readonly TermsEdition[];

/**
 * Check the ledger, or throw (audit 2026-09-11, B-44).
 *
 * Three properties, each of which the clickwrap's legal value depends on:
 *
 *   1. **versions strictly increase** — the number stored in a consent
 *      record, and carried in the packet's u16, names one edition and not a
 *      set of them;
 *   2. **dates strictly increase** — and therefore never repeat. This is the
 *      load-bearing one: the signer's bytes name a DATE, so a repeated date
 *      would let a signature for the earlier edition verify for the later,
 *      and the record would claim consent the signer never gave. A same-day
 *      correction to the terms is a perfectly ordinary thing for a legal
 *      document, which is exactly why this is checked rather than assumed;
 *   3. **the current edition is the newest one** — the service's idea of
 *      "current" is the last row, so a config whose top-level fields point
 *      somewhere else is a mistake, not a configuration.
 *
 * Contiguity is deliberately NOT required: skipping a version number is the
 * founder's call and breaks nothing here.
 *
 * Throws rather than returning a verdict. There is no useful degraded mode:
 * a service that cannot tell which edition a signature refers to must not
 * accept signatures.
 */
export function assertEditionLedger(ledger: TermsLedger, current: TermsEdition): void {
  if (!Array.isArray(ledger) || ledger.length === 0) {
    throw new Error('terms config: editions must be a non-empty array');
  }
  let previous: TermsEdition | null = null;
  for (const edition of ledger) {
    if (!Number.isInteger(edition.version) || edition.version < 1) {
      throw new Error(
        `terms config: every edition needs a positive integer version, got ${String(edition.version)}`
      );
    }
    // Reuse the message formatter's own date check, so an edition that
    // cannot be rendered into the signed statement cannot be registered.
    formatTermsDate(edition.updated);
    if (previous) {
      if (edition.version <= previous.version) {
        throw new Error(
          `terms config: edition versions must strictly increase, got ${previous.version} then ${edition.version}`
        );
      }
      if (edition.updated <= previous.updated) {
        // ISO `YYYY-MM-DD` compares correctly as a string.
        throw new Error(
          `terms config: edition dates must strictly increase, got ${previous.updated} (v${previous.version}) ` +
            `then ${edition.updated} (v${edition.version}). Two editions sharing a date would let a signature ` +
            `for one verify for the other, because the signed statement names the date.`
        );
      }
    }
    previous = edition;
  }
  const newest = ledger[ledger.length - 1];
  if (current.version !== newest.version || current.updated !== newest.updated) {
    throw new Error(
      `terms config: the current edition must be the newest in the ledger — config says ` +
        `v${current.version} dated ${current.updated}, the ledger ends at v${newest.version} dated ${newest.updated}`
    );
  }
}
