/**
 * Review authentication (C10): every decision POST is individually signed
 * by a reviewer wallet that must appear in the founder-owned member list
 * (`config/reviewers.json` — the operating Squads multisig's members,
 * maintained alongside the vault's membership). There is no session and no
 * password: the wallet signature over the canonical decision message IS the
 * login, and it goes into the log, so the authorization is re-checkable by
 * anyone holding the log — the same posture as the attestation clickwrap.
 *
 * Freshness: the signed timestamp must be within a small window of the
 * server's clock, so a captured request cannot be replayed later.
 *
 * REPLAY INSIDE THE WINDOW IS CLOSED BY THE LOG, NOT BY THE CLOCK (audit
 * 2026-09-11, B-23). This header used to argue that a replay inside the
 * window merely re-applied an idempotent-or-failing chain action, so the
 * chain was the backstop and the window was hygiene. That was wrong in the
 * case that matters: `GET /decisions` publishes every field of an accepted
 * decision — signature included — on an unauthenticated route, so the
 * service itself handed out complete, ready-to-send replay material, and a
 * `clear` captured from it and re-sent five minutes later after the reviewer
 * had flagged the entry again would land and un-flag it. The service now
 * refuses any submission whose signature is already on the record for that
 * entry (`server.ts`), which makes the published row proof that its own
 * signature is spent. Ed25519 is deterministic, so the signature IS the
 * nonce: the same reviewer, entry, action, criterion and instant always
 * produce the same 64 bytes, and a second arrival of those bytes is a replay
 * by definition. See `server.ts` for why that was chosen over a nonce column.
 *
 * The signed timestamp must also be in the CANONICAL spelling
 * (`new Date().toISOString()`), because the signature covers the string and
 * the log has to store and serve back exactly those bytes (migration 0020,
 * A-04 / B-21). Both of our signing clients emit that form already.
 *
 * The member list ships EMPTY: with no members, no decision verifies —
 * fail-closed until the founder fills it with the real Squads member keys.
 */

import nacl from 'tweetnacl';
import { base58Decode } from '../../_shared/src/blotto-events';
import type { Decision } from './review';
import { canonicalReviewMessage } from './review-message';

export { canonicalReviewMessage } from './review-message';

export interface ReviewerRegistry {
  version: number;
  /** Base58 wallet public keys of the admin multisig's members. */
  members: string[];
  updated: string;
}

/** Parse and validate the reviewers config; throws on any malformation. */
export function parseReviewerRegistry(raw: unknown): ReviewerRegistry {
  const r = raw as { version?: unknown; members?: unknown; updated?: unknown };
  if (
    !r ||
    typeof r.version !== 'number' ||
    r.version < 1 ||
    !Array.isArray(r.members) ||
    r.members.some((m) => typeof m !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)) ||
    typeof r.updated !== 'string'
  ) {
    throw new Error('reviewers config malformed');
  }
  return { version: r.version, members: [...(r.members as string[])], updated: r.updated };
}

/** Default freshness window: five minutes either side. */
export const REVIEW_SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

/**
 * The one spelling of an instant this service accepts and stores:
 * `YYYY-MM-DDTHH:MM:SS.sssZ`, which is exactly what
 * `Date.prototype.toISOString()` emits.
 *
 * A signature covers the timestamp as TEXT, so two equivalent spellings of
 * the same instant are two different messages. Pinning the spelling is what
 * lets the log keep the signed string and its indexed instant in two columns
 * without them ever disagreeing (migration 0020).
 */
const CANONICAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** True when `s` is the canonical spelling AND a real instant. */
export function isCanonicalIsoInstant(s: string): boolean {
  if (!CANONICAL_ISO.test(s)) return false;
  const t = Date.parse(s);
  return Number.isFinite(t) && new Date(t).toISOString() === s;
}

/**
 * Why a submission was refused, or `null` when it verifies.
 *
 *   `not_member`     the signing key is not in the registry
 *   `bad_timestamp`  not the canonical ISO spelling of a real instant
 *   `clock_skew`     genuine signature, but signed outside the window
 *   `bad_signature`  the signature does not verify for the claimed key
 *
 * The ROUTE still answers one uniform 401 for a reviewer decision — which
 * check failed is not an outsider's business, and telling them turns the
 * endpoint into a member-list oracle. The reason exists so the SERVICE can
 * log it (audit B-35: a failed reviewer authentication left no trace at all)
 * and so the player-facing appeal route can distinguish a clock problem from
 * a signature problem (D-33), where the submitter already knows their own
 * key and nothing is leaked by saying which.
 */
export type SubmissionRefusal = 'not_member' | 'bad_timestamp' | 'clock_skew' | 'bad_signature';

/**
 * Verify one submitted decision: member, timestamp spelling, freshness,
 * signature — in that order, so the reason is the most specific true one.
 */
export function reviewSubmissionRefusal(
  registry: ReviewerRegistry,
  decision: Decision,
  nowMs: number,
  windowMs: number = REVIEW_SIGNATURE_WINDOW_MS
): SubmissionRefusal | null {
  try {
    if (!registry.members.includes(decision.decidedBy)) return 'not_member';
    if (!isCanonicalIsoInstant(decision.decidedAt)) return 'bad_timestamp';
    const at = Date.parse(decision.decidedAt);
    if (Math.abs(nowMs - at) > windowMs) return 'clock_skew';
    const signature = Uint8Array.from(Buffer.from(decision.signature, 'base64'));
    if (signature.length !== 64) return 'bad_signature';
    const message = canonicalReviewMessage({
      pool: decision.pool,
      player: decision.player,
      action: decision.action,
      criterion: decision.criterion,
      signedAt: decision.decidedAt,
    });
    return nacl.sign.detached.verify(message, signature, base58Decode(decision.decidedBy))
      ? null
      : 'bad_signature';
  } catch {
    return 'bad_signature';
  }
}

/**
 * The bare-boolean form the route used before the reasons existed, kept
 * because "did this verify" is the question most callers ask.
 */
export function verifyReviewSubmission(
  registry: ReviewerRegistry,
  decision: Decision,
  nowMs: number,
  windowMs: number = REVIEW_SIGNATURE_WINDOW_MS
): boolean {
  return reviewSubmissionRefusal(registry, decision, nowMs, windowMs) === null;
}
