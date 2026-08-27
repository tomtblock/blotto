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
 * server's clock, so a captured request cannot be replayed later. A replay
 * INSIDE the window re-applies the same idempotent-or-failing chain action
 * (a second clear finds the flag cleared; a second release finds no
 * escrow) — the chain is the backstop, the window is the hygiene.
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
 * Verify one submitted decision: member, signature, freshness. Answers a
 * bare boolean — the route returns one uniform 401 for every failure mode.
 */
export function verifyReviewSubmission(
  registry: ReviewerRegistry,
  decision: Decision,
  nowMs: number,
  windowMs: number = REVIEW_SIGNATURE_WINDOW_MS
): boolean {
  try {
    if (!registry.members.includes(decision.decidedBy)) return false;
    const at = Date.parse(decision.decidedAt);
    if (!Number.isFinite(at) || Math.abs(nowMs - at) > windowMs) return false;
    const signature = Uint8Array.from(Buffer.from(decision.signature, 'base64'));
    if (signature.length !== 64) return false;
    const message = canonicalReviewMessage({
      pool: decision.pool,
      player: decision.player,
      action: decision.action,
      criterion: decision.criterion,
      signedAt: decision.decidedAt,
    });
    return nacl.sign.detached.verify(message, signature, base58Decode(decision.decidedBy));
  } catch {
    return false;
  }
}
