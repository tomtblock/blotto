/**
 * The age/terms attestation store (D-B4, ratified 2026-08-27).
 *
 * Age and identity policy at launch is a SELF-ATTESTATION clickwrap only —
 * "I am over 18" plus terms acceptance, versioned. There is neither a KYC
 * provider nor an age-verification vendor (the KYC-at-claim switch stays built and
 * OFF, untouched). What this module makes durable is the record:
 *
 *   { wallet, terms_version, attested_18: true, timestamp, wallet_signature }
 *
 * The signature is the wallet's Ed25519 signature over the canonical
 * attestation message below, verified BEFORE anything is stored — the record
 * proves the keyholder clicked, not merely that the browser POSTed. Packet
 * issuance then requires a stored attestation at the CURRENT terms version
 * (config/terms.json); an older version means the clickwrap re-prompts.
 */

import nacl from 'tweetnacl';
import { readFileSync } from 'fs';
import { attestationMessage, type TermsEdition } from '../../_shared/src/attestation-message';
import { base58Decode } from './shared';

export { attestationMessage, type TermsEdition };

export interface AttestationRecord {
  /** Base58 wallet. */
  wallet: string;
  termsVersion: number;
  /** Always true — the record exists only for an accepted clickwrap. */
  attested18: true;
  /** Unix seconds at acceptance (server clock). */
  timestamp: bigint;
  /** Base64 Ed25519 signature over `attestationMessage(...)`. */
  walletSignature: string;
}

export interface AttestationStore {
  /** Latest record per wallet (a re-attestation at a newer version replaces). */
  get(wallet: string): Promise<AttestationRecord | null>;
  put(record: AttestationRecord): Promise<void>;
}

/** In-memory reference store — the Postgres twin follows the same contract. */
export class MemoryAttestationStore implements AttestationStore {
  private readonly rows = new Map<string, AttestationRecord>();
  async get(wallet: string): Promise<AttestationRecord | null> {
    return this.rows.get(wallet) ?? null;
  }
  async put(record: AttestationRecord): Promise<void> {
    this.rows.set(record.wallet, record);
  }
}

/**
 * The current terms edition, from the founder-owned config/terms.json: the
 * version the packet carries and the date the signed statement names.
 */
export function loadTerms(path: string): TermsEdition {
  const doc = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown; updated?: unknown };
  if (!Number.isInteger(doc.version) || (doc.version as number) < 1) {
    throw new Error('terms config: version must be a positive integer');
  }
  if (typeof doc.updated !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.updated)) {
    throw new Error('terms config: updated must be a YYYY-MM-DD date');
  }
  return { version: doc.version as number, updated: doc.updated };
}

/** Current terms version only — kept for callers that need just the number. */
export function loadTermsVersion(path: string): number {
  return loadTerms(path).version;
}

export interface AttestationSubmission {
  wallet: string;
  termsVersion: number;
  /** Base64 Ed25519 signature over `attestationMessage(wallet, currentTerms)`. */
  signature: string;
}

/**
 * Verify a submission and store it. Returns false (storing nothing) when the
 * version is not the current one or the signature does not verify against
 * the wallet's own key — the caller answers with a plain refusal either way.
 */
export async function acceptAttestation(
  store: AttestationStore,
  currentTerms: TermsEdition,
  now: () => bigint,
  submission: AttestationSubmission
): Promise<boolean> {
  if (submission.termsVersion !== currentTerms.version) return false;
  let signature: Uint8Array;
  let pubkey: Uint8Array;
  try {
    signature = new Uint8Array(Buffer.from(submission.signature, 'base64'));
    pubkey = base58Decode(submission.wallet);
  } catch {
    return false;
  }
  if (signature.length !== 64 || pubkey.length !== 32) return false;
  const message = attestationMessage(submission.wallet, currentTerms);
  if (!nacl.sign.detached.verify(message, signature, pubkey)) return false;
  await store.put({
    wallet: submission.wallet,
    termsVersion: submission.termsVersion,
    attested18: true,
    timestamp: now(),
    walletSignature: submission.signature,
  });
  return true;
}
