/*
 * The desk's half of the complaints route (2026-09-22) — reading the queue
 * and answering a complaint.
 *
 * WHY THIS EXISTS. Until now nothing in this repository could append an
 * `acknowledged` or a `resolved` row. The store and the row shape were
 * built on 2026-09-19 and no code wrote them, so a player who checked their
 * reference read *received* however promptly a person had actually answered
 * — which made the published five-working-day and thirty-day windows look
 * unkept when they were not. It was recorded in `PRODUCT-FACTS` §9 at the
 * time rather than left to be discovered. This closes it.
 *
 * TWO DIFFERENT PATHS, deliberately:
 *
 *   READING the queue goes through OUR OWN server route (`/api/complaints`),
 *   because the review service guards that read with an operator token and
 *   a token must never reach a browser bundle. The route proves the caller
 *   is a reviewer before it spends the token.
 *
 *   ANSWERING goes STRAIGHT to the review service, exactly as a decision
 *   does, because the service verifies the reviewer's own signature over the
 *   canonical answer message — and that signature is the whole point. It is
 *   what makes the stored `decided_by` evidence instead of an assertion. A
 *   proxy in that path could only weaken it: the service would then be
 *   trusting this app about who answered.
 *
 * Pure functions over an injected `fetch` and an injected signer, like
 * `app/src/complaints/complaint.ts` on the player's side, so every ending is
 * a value a test can assert on rather than a state only a browser reaches.
 */

import {
  canonicalComplaintAnswerMessage,
  COMPLAINT_REFERENCE_PATTERN,
} from '@blotto/detection/complaint-message';
import {
  COMPLAINT_NOTE_MAX,
  type ComplaintCategory,
} from '@blotto/detection/complaints';
import { complaintsQueueMessage } from './complaints-request';

export { COMPLAINT_NOTE_MAX };

/** What the desk can sign with — the same optional shape the rest uses. */
export interface DeskSigner {
  signMessage?(message: Uint8Array): Promise<Uint8Array>;
}

/** One complaint as the queue serves it. */
export interface QueuedComplaint {
  reference: string;
  category: ComplaintCategory;
  pool: string | null;
  text: string;
  /** True when the complainant PROVED the address the complaint concerns. */
  signed: boolean;
  wallet: string | null;
  receivedAt: string;
}

/**
 * What reading the queue can end as. Every ending is named, for the reason
 * the player-side module gives at length: "the desk is empty" and "we could
 * not reach the desk" are different statements and must not share a
 * rendering.
 */
export type QueueRead =
  | {
      kind: 'queue';
      open: QueuedComplaint[];
      acknowledgeWorkingDays: number;
      resolveDays: number;
    }
  | { kind: 'cannot_sign' }
  | { kind: 'declined' }
  | { kind: 'unauthorized' }
  | { kind: 'not_configured' }
  | { kind: 'unreachable' };

/** Read the open queue, proving to our own route that this is a reviewer. */
export async function loadComplaintQueue(
  reviewer: string | null,
  signer: DeskSigner | undefined,
  fetchImpl: typeof fetch = fetch,
  limit?: number
): Promise<QueueRead> {
  if (!reviewer || !signer?.signMessage) return { kind: 'cannot_sign' };
  const requestedAt = new Date().toISOString();
  let signature: Uint8Array;
  try {
    signature = await signer.signMessage(complaintsQueueMessage({ reviewer, requestedAt }));
  } catch {
    return { kind: 'declined' };
  }
  let res: Response;
  try {
    res = await fetchImpl('/api/complaints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reviewer,
        requestedAt,
        signature: btoa(String.fromCharCode(...signature)),
        ...(limit === undefined ? {} : { limit }),
      }),
    });
  } catch {
    return { kind: 'unreachable' };
  }
  if (res.status === 401) return { kind: 'unauthorized' };
  if (res.status === 503) return { kind: 'not_configured' };
  if (!res.ok) return { kind: 'unreachable' };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { kind: 'unreachable' };
  }
  if (!isQueueBody(body)) return { kind: 'unreachable' };
  return {
    kind: 'queue',
    open: body.open,
    acknowledgeWorkingDays: body.acknowledgeWorkingDays,
    resolveDays: body.resolveDays,
  };
}

function isQueueBody(
  v: unknown
): v is { open: QueuedComplaint[]; acknowledgeWorkingDays: number; resolveDays: number } {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    Array.isArray(o.open) &&
    typeof o.acknowledgeWorkingDays === 'number' &&
    typeof o.resolveDays === 'number'
  );
}

/**
 * What answering can end as.
 *
 *   `recorded`         appended; the player's status now follows it
 *   `cannot_sign`      no reviewer wallet, or one that cannot sign a message
 *   `declined`         the reviewer declined the wallet prompt
 *   `unauthorized`     not a registry key, a bad signature, or stale
 *   `not_found`        no complaint carries that reference
 *   `already_recorded` this exact answer is already on the thread
 *   `malformed`        the service would not accept the shape
 *   `not_configured`   no complaints store in that deployment
 *   `unreachable`      the service did not answer usably
 */
export type AnswerOutcome =
  | 'recorded'
  | 'cannot_sign'
  | 'declined'
  | 'unauthorized'
  | 'not_found'
  | 'already_recorded'
  | 'malformed'
  | 'not_configured'
  | 'unreachable';

/** True when this note is sendable — the same bound the service applies. */
export function noteValid(note: string): boolean {
  const t = note.trim();
  return t.length > 0 && note.length <= COMPLAINT_NOTE_MAX;
}

/**
 * Acknowledge or resolve a complaint: sign the canonical answer bytes with
 * the reviewer's own key, then append.
 *
 * The signature covers the note as well as the reference and the kind,
 * because the note is what the player is shown. An operator who could
 * change it after signing could answer one thing and publish another.
 */
export async function answerComplaint(
  apiBase: string | undefined,
  reviewer: string | null,
  signer: DeskSigner | undefined,
  answer: { reference: string; kind: 'acknowledged' | 'resolved'; note: string },
  fetchImpl: typeof fetch = fetch
): Promise<AnswerOutcome> {
  if (!apiBase) return 'not_configured';
  if (!reviewer || !signer?.signMessage) return 'cannot_sign';
  if (!COMPLAINT_REFERENCE_PATTERN.test(answer.reference)) return 'malformed';
  if (!noteValid(answer.note)) return 'malformed';

  const decidedAt = new Date().toISOString();
  let signature: Uint8Array;
  try {
    signature = await signer.signMessage(
      canonicalComplaintAnswerMessage({
        reference: answer.reference,
        kind: answer.kind,
        decidedBy: reviewer,
        note: answer.note,
        signedAt: decidedAt,
      })
    );
  } catch {
    return 'declined';
  }

  let res: Response;
  try {
    res = await fetchImpl(`${apiBase}/complaints/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reference: answer.reference,
        kind: answer.kind,
        decidedBy: reviewer,
        note: answer.note,
        decidedAt,
        signature: btoa(String.fromCharCode(...signature)),
      }),
    });
  } catch {
    return 'unreachable';
  }
  if (res.status === 204) return 'recorded';
  if (res.status === 401) return 'unauthorized';
  if (res.status === 404) return 'not_found';
  if (res.status === 503) return 'not_configured';
  if (res.status === 400) return 'malformed';
  if (res.status === 409) {
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    return b.error === 'already_recorded' ? 'already_recorded' : 'unreachable';
  }
  return 'unreachable';
}
