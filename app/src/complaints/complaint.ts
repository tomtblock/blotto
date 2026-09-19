/*
 * The client half of the complaints route (2026-09-19): mint a reference,
 * sign the canonical bytes where the category requires it, submit, and read
 * the status back.
 *
 * The message bytes come from the SAME module the server verifies with
 * (@blotto/detection/complaint-message), exactly as the attestation, notify
 * and appeal flows do — the two ends cannot drift, because there is one
 * definition. No arithmetic and no judgement: this module carries text and
 * signatures.
 *
 * EVERY ENDING IS NAMED. `not_configured` (this build has no review service)
 * and `unreachable` (a service is configured and did not answer usably) are
 * distinct from `refused` (the service considered it and said no), because
 * telling a player their complaint was refused when in truth it never
 * arrived is the C-04 defect in its most damaging form — the complaint is
 * the last route they have.
 */

import {
  COMPLAINT_REFERENCE_ALPHABET,
  COMPLAINT_REFERENCE_PATTERN,
  canonicalComplaintMessage,
} from '@blotto/detection/complaint-message';
import {
  COMPLAINT_CATEGORY_KEYS,
  COMPLAINT_TEXT_MAX,
  signatureRequired,
  type ComplaintCategory,
} from '@blotto/detection/complaints';

export { COMPLAINT_CATEGORY_KEYS, COMPLAINT_TEXT_MAX, signatureRequired };
export type { ComplaintCategory };

export interface MessageSigner {
  signMessage?(message: Uint8Array): Promise<Uint8Array>;
}

/**
 * Mint a reference: `BC-` plus eight characters of an alphabet with no
 * 0/O/1/I, so a player can read it down a telephone or copy it out of an
 * email without ambiguity.
 *
 * `crypto.getRandomValues` where the browser has it; `Math.random` is the
 * fallback and is fine — a reference is a handle, not a secret, and the
 * status route refuses to serve a signed complaint to anyone but the wallet
 * that signed it. The modulo bias over a 32-character alphabet drawn from
 * 256 values is nil (256 = 8 × 32).
 */
export function mintReference(random: (n: number) => Uint8Array = randomBytes): string {
  const bytes = random(8);
  let out = 'BC-';
  for (let i = 0; i < 8; i++) {
    out += COMPLAINT_REFERENCE_ALPHABET[bytes[i] % COMPLAINT_REFERENCE_ALPHABET.length];
  }
  return out;
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(out);
    return out;
  }
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/** True when this text is submittable — the same bound the service applies. */
export function complaintTextValid(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && text.length <= COMPLAINT_TEXT_MAX;
}

export interface ComplaintDraft {
  category: ComplaintCategory;
  text: string;
  /** The pool it is about, when it is about one. */
  pool?: string | null;
}

/**
 * What submitting can end as.
 *
 *   `submitted`       recorded; the reference is the player's handle
 *   `not_configured`  no review service in this build
 *   `unreachable`     a service is configured and did not answer usably
 *   `signature_required` the category needs a signed submission and this
 *                     wallet cannot sign, or is not signed in
 *   `cannot_sign`     a signed-in wallet that cannot sign a message
 *   `declined`        the player declined the wallet prompt
 *   `clock_skew`      a genuine signature, signed too far from our clock
 *   `refused`         the signature did not verify as this wallet
 *   `already_lodged`  that reference is already on the record
 *   `too_long`        over the published length, or empty — OUR OWN check,
 *                     made before anything is sent
 *   `not_accepted`    the service would not accept the shape it was sent
 */
export type ComplaintOutcome =
  | 'submitted'
  | 'not_configured'
  | 'unreachable'
  | 'signature_required'
  | 'cannot_sign'
  | 'declined'
  | 'clock_skew'
  | 'refused'
  | 'already_lodged'
  | 'too_long'
  | 'not_accepted';

export interface ComplaintResult {
  outcome: ComplaintOutcome;
  /** The reference, on `submitted` only — what the player keeps. */
  reference: string | null;
}

/**
 * Sign where the category requires it, then submit. Nothing is retried and
 * nothing is guessed on the player's behalf.
 *
 * `wallet` and `signer` are optional throughout: an unsigned submission is
 * the point of the other three categories, and a player locked out of their
 * wallet is exactly the player who needs this route.
 */
export async function submitComplaint(
  apiBase: string | undefined,
  draft: ComplaintDraft,
  identity: { wallet?: string | null; signer?: MessageSigner } = {},
  fetchImpl: typeof fetch = fetch,
  reference: string = mintReference()
): Promise<ComplaintResult> {
  if (!apiBase) return { outcome: 'not_configured', reference: null };
  if (!complaintTextValid(draft.text)) return { outcome: 'too_long', reference: null };
  if (!COMPLAINT_REFERENCE_PATTERN.test(reference)) {
    // A caller-supplied reference that cannot be signed or stored. Refusing
    // here beats sending bytes the service will reject.
    return { outcome: 'refused', reference: null };
  }

  const needsSignature = signatureRequired(draft.category);
  const wallet = identity.wallet ?? null;
  const body: Record<string, unknown> = {
    reference,
    category: draft.category,
    text: draft.text,
    pool: draft.pool ?? null,
  };

  if (needsSignature) {
    if (!wallet) return { outcome: 'signature_required', reference: null };
    if (!identity.signer?.signMessage) return { outcome: 'cannot_sign', reference: null };
    const signedAt = new Date().toISOString();
    let signature: Uint8Array;
    try {
      signature = await identity.signer.signMessage(
        canonicalComplaintMessage({
          reference,
          wallet,
          category: draft.category,
          pool: draft.pool ?? null,
          text: draft.text,
          signedAt,
        })
      );
    } catch {
      return { outcome: 'declined', reference: null };
    }
    body.wallet = wallet;
    body.signedAt = signedAt;
    body.signature = btoa(String.fromCharCode(...signature));
  }

  try {
    const res = await fetchImpl(`${apiBase}/complaints`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 204) return { outcome: 'submitted', reference };
    if (res.status === 503) return { outcome: 'not_configured', reference: null };
    if (res.status === 401) {
      const b = (await res.json().catch(() => ({}))) as { reason?: string };
      return { outcome: b.reason === 'clock_skew' ? 'clock_skew' : 'refused', reference: null };
    }
    if (res.status === 409) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      if (b.error === 'already_lodged') return { outcome: 'already_lodged', reference: null };
      if (b.error === 'signature_required') return { outcome: 'signature_required', reference: null };
    }
    // A 400 is NOT reported as "too long". Our own length check ran before
    // anything was sent and already returned `too_long`, so a 400 from the
    // service means a shape it would not accept — in practice the `pool` the
    // calling page passed (the inline form on a results page passes the route
    // param). Telling that player to shorten their words would send them
    // round the loop shortening a complaint that was never too long, on the
    // one route that is their last resort. PHASE-N-REVIEW (2026-09-19): found
    // by the end-to-end walk, which sent a pool identifier the service reads
    // as malformed and was told the text was too long.
    if (res.status === 400) return { outcome: 'not_accepted', reference: null };
    return { outcome: 'unreachable', reference: null };
  } catch {
    return { outcome: 'unreachable', reference: null };
  }
}

/** What the status route answers — `complaints.ts::ComplaintStatus`. */
export interface ComplaintStatusView {
  reference: string;
  status: 'received' | 'acknowledged' | 'resolved';
  category: ComplaintCategory;
  receivedAt: string;
  signed: boolean;
  text: string;
  note: string | null;
  acknowledgeWorkingDays: number;
  resolveDays: number;
}

/** What reading a status can end as — the same three-way split as the lodge. */
export type ComplaintStatusRead =
  | { kind: 'status'; status: ComplaintStatusView }
  | { kind: 'not_found' }
  | { kind: 'not_configured' }
  | { kind: 'unreachable' };

export async function fetchComplaintStatus(
  apiBase: string | undefined,
  reference: string,
  wallet: string | null,
  fetchImpl: typeof fetch = fetch
): Promise<ComplaintStatusRead> {
  if (!apiBase) return { kind: 'not_configured' };
  if (!COMPLAINT_REFERENCE_PATTERN.test(reference)) return { kind: 'not_found' };
  const query = new URLSearchParams({ ref: reference });
  if (wallet) query.set('wallet', wallet);
  let res: Response;
  try {
    res = await fetchImpl(`${apiBase}/complaints?${query.toString()}`);
  } catch {
    return { kind: 'unreachable' };
  }
  if (res.status === 404) return { kind: 'not_found' };
  if (res.status === 503) return { kind: 'not_configured' };
  if (!res.ok) return { kind: 'unreachable' };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { kind: 'unreachable' };
  }
  if (!isStatus(body)) return { kind: 'unreachable' };
  return { kind: 'status', status: body };
}

function isStatus(v: unknown): v is ComplaintStatusView {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.reference === 'string' &&
    typeof o.status === 'string' &&
    typeof o.category === 'string' &&
    typeof o.text === 'string' &&
    typeof o.acknowledgeWorkingDays === 'number' &&
    typeof o.resolveDays === 'number'
  );
}
