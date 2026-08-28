/**
 * The email-notification opt-in store (v3 D3).
 *
 * Notifications are OPT-IN and factual: a pool the wallet entered sealed,
 * committed results, paid, or refunded. Nothing here schedules marketing,
 * and nothing sends yet — this module makes the CHOICE durable:
 *
 *   { wallet, email_opt_in, timestamp, wallet_signature }
 *
 * The signature is the wallet's Ed25519 signature over the canonical
 * message below, verified BEFORE anything is stored — same discipline as
 * the attestation store: the record proves the keyholder chose, not merely
 * that a browser POSTed. The message carries the choice and a client
 * timestamp; the server accepts only a bounded clock skew and never lets an
 * older message overwrite a newer stored choice (a captured opt-out cannot
 * be replayed over a later opt-in).
 *
 * The address itself is NOT stored here: the sign-in provider (Privy) holds
 * the account's email; the dispatch job reads the flag from this store and
 * resolves the address at send time. Dispatch needs a mail vendor and is a
 * deployment item (docs/hosting.md lists the need); this store is complete
 * without it.
 */

import nacl from 'tweetnacl';
import { base58Decode } from './shared';

/** Canonical signed message. Version-prefixed like the attestation message. */
export function notifyMessage(wallet: string, emailOptIn: boolean, atUnix: bigint): Uint8Array {
  return new TextEncoder().encode(
    `blotto-cup notify v1\nwallet: ${wallet}\nemail: ${emailOptIn ? 'on' : 'off'}\nat: ${atUnix}`
  );
}

export interface NotifyPreferenceRecord {
  wallet: string;
  emailOptIn: boolean;
  /** Unix seconds from the SIGNED message (monotonicity guard). */
  timestamp: bigint;
  /** Base64 Ed25519 signature over `notifyMessage(...)`. */
  walletSignature: string;
}

export interface NotifyPreferenceStore {
  get(wallet: string): Promise<NotifyPreferenceRecord | null>;
  put(record: NotifyPreferenceRecord): Promise<void>;
}

/** In-memory reference store — the Postgres twin follows the same contract
 * (backend/_shared/migrations/0009_notify_optin.sql). */
export class MemoryNotifyPreferenceStore implements NotifyPreferenceStore {
  private readonly rows = new Map<string, NotifyPreferenceRecord>();
  async get(wallet: string): Promise<NotifyPreferenceRecord | null> {
    return this.rows.get(wallet) ?? null;
  }
  async put(record: NotifyPreferenceRecord): Promise<void> {
    this.rows.set(record.wallet, record);
  }
}

export interface NotifySubmission {
  wallet: string;
  emailOptIn: boolean;
  /** Unix seconds the client signed into the message. */
  atUnix: bigint;
  /** Base64 Ed25519 signature over `notifyMessage(wallet, emailOptIn, atUnix)`. */
  signature: string;
}

/** Accept a signed message no older/newer than this many seconds. */
export const NOTIFY_MAX_SKEW_SECONDS = 600n;

/**
 * Verify a submission and store it. Returns false (storing nothing) when
 * the signature does not verify, the signed timestamp is outside the skew
 * window, or a newer choice is already stored.
 */
export async function acceptNotifyPreference(
  store: NotifyPreferenceStore,
  now: () => bigint,
  submission: NotifySubmission
): Promise<boolean> {
  let signature: Uint8Array;
  let pubkey: Uint8Array;
  try {
    signature = new Uint8Array(Buffer.from(submission.signature, 'base64'));
    pubkey = base58Decode(submission.wallet);
  } catch {
    return false;
  }
  if (signature.length !== 64 || pubkey.length !== 32) return false;

  const at = submission.atUnix;
  const t = now();
  const skew = at > t ? at - t : t - at;
  if (skew > NOTIFY_MAX_SKEW_SECONDS) return false;

  const message = notifyMessage(submission.wallet, submission.emailOptIn, at);
  if (!nacl.sign.detached.verify(message, signature, pubkey)) return false;

  const existing = await store.get(submission.wallet);
  if (existing !== null && existing.timestamp >= at) return false;

  await store.put({
    wallet: submission.wallet,
    emailOptIn: submission.emailOptIn,
    timestamp: at,
    walletSignature: submission.signature,
  });
  return true;
}
