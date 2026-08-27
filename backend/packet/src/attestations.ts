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
import { attestationMessage } from '../../_shared/src/attestation-message';
import { base58Decode } from './shared';

export { attestationMessage };

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

/** Current terms version, from the founder-owned config/terms.json. */
export function loadTermsVersion(path: string): number {
  const doc = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown };
  if (!Number.isInteger(doc.version) || (doc.version as number) < 1) {
    throw new Error('terms config: version must be a positive integer');
  }
  return doc.version as number;
}

export interface AttestationSubmission {
  wallet: string;
  termsVersion: number;
  /** Base64 Ed25519 signature over `attestationMessage(wallet, termsVersion)`. */
  signature: string;
}

/**
 * Verify a submission and store it. Returns false (storing nothing) when the
 * version is not the current one or the signature does not verify against
 * the wallet's own key — the caller answers with a plain refusal either way.
 */
export async function acceptAttestation(
  store: AttestationStore,
  currentVersion: number,
  now: () => bigint,
  submission: AttestationSubmission
): Promise<boolean> {
  if (submission.termsVersion !== currentVersion) return false;
  let signature: Uint8Array;
  let pubkey: Uint8Array;
  try {
    signature = new Uint8Array(Buffer.from(submission.signature, 'base64'));
    pubkey = base58Decode(submission.wallet);
  } catch {
    return false;
  }
  if (signature.length !== 64 || pubkey.length !== 32) return false;
  const message = attestationMessage(submission.wallet, submission.termsVersion);
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
