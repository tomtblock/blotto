/**
 * The appeal route (Phase 2 Stage E), as the rules page published it until
 * 2026-09-19:
 *
 *   "You may appeal within 7 days of being notified, and the appeal is
 *    decided by a different reviewer within a further 7 days. Every
 *    decision is published in a signed log naming the reviewer, the time,
 *    and the criterion cited."
 *
 * THAT SENTENCE IS NO LONGER PUBLISHED. The named reviewer came out of the
 * player-facing product on 2026-09-19 and a player now challenges a
 * decision through the complaints route. Everything below stays: the
 * append-only log, the canonical signed messages, the lodge window and the
 * per-entry rules are the operator's record of a challenge, and the rows
 * already written must go on verifying. Only the `same_reviewer` limb is
 * gone — see the decision bullet.
 *
 * Everything here is a PURE function over one entry's thread in the signed
 * log (`DecisionLog.listFor`), so the rules are unit-tested without a
 * server and re-checkable by anyone holding the log:
 *
 *   - What is appealable: an UPHELD flag — the latest `forfeit` row. A flag
 *     that is merely pending resolves by release or by the review clock;
 *     there is nothing to appeal until a reviewer has taken the prize.
 *   - "Notified": the forfeit row's `decidedAt`. The log is public and the
 *     results page shows the held share, so that instant is the earliest
 *     the player could know and the one both sides can prove.
 *   - The lodge window: seven days from that instant, measured on the
 *     appellant's SIGNED timestamp (which must also be fresh against the
 *     server clock, like every other signed submission here).
 *   - One appeal per upheld flag. A second lodge is refused.
 *   - The decision: by any registry member. It used to be refused to the
 *     reviewer whose forfeit was under appeal, on the published promise that
 *     "the appeal is decided by a different reviewer" — a promise the
 *     founder-owned registry could not keep, because it holds one person, so
 *     no appeal could be decided AT ALL (audit O24). That limb came out on
 *     2026-09-19 when the named-reviewer apparatus left the player-facing
 *     product: Blotto Cup is the reviewer of record, a human still decides,
 *     and a player challenges a decision through the complaints route
 *     (`complaints.ts`), where a decision on a challenge is taken by
 *     someone other than whoever made the original one WHEREVER THAT IS
 *     POSSIBLE — the terms' words, and an undertaking about who we ask
 *     rather than a check a one-member registry fails. The seven days to
 *     decide are RECORDED (the lodge and decision rows carry their times)
 *     rather than enforced by a timer — a late decision is still better
 *     than none, and the log shows it was late.
 *   - No chain action. The program has no un-forfeit; an upheld appeal is
 *     the operator's published undertaking to pay from its own funds.
 *
 * `verifyRow` rechecks ANY row of the log from the row alone plus the
 * registry: reviewer rows against the review message and the member list,
 * the player-signed lodge against the appeal message and the row's own
 * player. That is the plan's acceptance test — "every row verifies against
 * the reviewer registry from the log alone" — as a function.
 */

import nacl from 'tweetnacl';
import { base58Decode } from '../../_shared/src/blotto-events';
import { canonicalAppealMessage } from './appeal-message';
import {
  REVIEW_SIGNATURE_WINDOW_MS,
  isCanonicalIsoInstant,
  type ReviewerRegistry,
  type SubmissionRefusal,
} from './auth';
import { canonicalReviewMessage } from './review-message';
import { REVIEWER_ACTIONS, type Decision } from './review';

/** Seven days to lodge, from the upheld flag's decision instant. */
export const APPEAL_LODGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Seven further days to decide — recorded, not enforced (module doc). */
export const APPEAL_DECIDE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** The grounds a player may write: non-empty, bounded like a criterion. */
export const APPEAL_GROUNDS_MAX = 2000;

/** What a player submits to lodge. `signedAt` doubles as the lodge time. */
export interface AppealSubmission {
  pool: string;
  player: string;
  grounds: string;
  signedAt: string;
  /** Base64 Ed25519 over `canonicalAppealMessage`, by `player`. */
  signature: string;
}

/** One entry's appeal position, derived from its thread. */
export interface AppealState {
  /** The upheld flag under (potential) appeal — the latest forfeit row. */
  forfeit: Decision | null;
  /** The lodge against THAT forfeit, if any. */
  lodged: Decision | null;
  /** The decision on THAT lodge, if any. */
  decided: Decision | null;
  /** ISO: when the lodge window closes (forfeit + 7 d), or null. */
  lodgeUntil: string | null;
  /** ISO: when the decision is due (lodge + 7 d), or null. */
  decideBy: string | null;
}

function at(d: Decision): number {
  return Date.parse(d.decidedAt);
}

/** Derive the appeal position from one entry's rows (any order). */
export function appealState(thread: readonly Decision[]): AppealState {
  const rows = [...thread].sort((a, b) => at(a) - at(b));
  let forfeit: Decision | null = null;
  for (const r of rows) if (r.action === 'forfeit') forfeit = r;
  if (!forfeit) return { forfeit: null, lodged: null, decided: null, lodgeUntil: null, decideBy: null };
  const after = rows.filter((r) => at(r) >= at(forfeit!));
  const lodged = after.find((r) => r.action === 'appeal_lodged') ?? null;
  const decided = lodged
    ? (after.find(
        (r) =>
          (r.action === 'appeal_upheld' || r.action === 'appeal_dismissed') && at(r) >= at(lodged)
      ) ?? null)
    : null;
  return {
    forfeit,
    lodged,
    decided,
    lodgeUntil: new Date(at(forfeit) + APPEAL_LODGE_WINDOW_MS).toISOString(),
    decideBy: lodged ? new Date(at(lodged) + APPEAL_DECIDE_WINDOW_MS).toISOString() : null,
  };
}

export type LodgeRefusal = 'nothing_to_appeal' | 'already_lodged' | 'window_closed';

/**
 * May this submission be lodged against this thread? Pure: the signature
 * and freshness are `verifyAppealSubmission`'s; this is the rule.
 */
export function lodgeRefusal(thread: readonly Decision[], signedAt: string): LodgeRefusal | null {
  const s = appealState(thread);
  if (!s.forfeit) return 'nothing_to_appeal';
  if (s.lodged) return 'already_lodged';
  const t = Date.parse(signedAt);
  if (!Number.isFinite(t) || t < at(s.forfeit) || t > Date.parse(s.lodgeUntil!)) {
    return 'window_closed';
  }
  return null;
}

export type AppealDecisionRefusal = 'no_open_appeal';

/**
 * May the open appeal on this thread be decided?
 *
 * ONE RULE NOW: there has to be an open appeal. The `same_reviewer` limb —
 * refusing the reviewer whose forfeit was under appeal — was removed on
 * 2026-09-19 with the published promise it enforced. It made the registry's
 * single member unable to decide anything, so the right it protected could
 * not be exercised by anyone (audit O24), and a check that blocks the only
 * available decider protects nobody. Who decides a challenge is now an
 * undertaking in the terms ("someone other than whoever made the original
 * one wherever that is possible") answered through the complaints route,
 * where a person reads it.
 *
 * `reviewer` is still taken, and still unused, deliberately: the signature
 * on the row identifies the decider either way, and the parameter keeps the
 * call sites and the log's attribution honest about what is being asked.
 */
export function appealDecisionRefusal(
  thread: readonly Decision[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept: see the doc above
  reviewer?: string
): AppealDecisionRefusal | null {
  const s = appealState(thread);
  if (!s.lodged || s.decided) return 'no_open_appeal';
  return null;
}

/**
 * The appellant's signature and freshness: signed by the row's own player
 * over the appeal message, within the same clock window every signed
 * submission gets.
 *
 * THE TWO CAUSES ARE NAMED, not collapsed (audit 2026-09-11, D-33). A
 * player whose device clock is a few minutes out gets a genuine signature
 * refused for freshness, and the service used to answer the same bare "no"
 * it gives a forged one — which the results page then renders as "the
 * signature did not verify as this entry's wallet". That is a wrong
 * accusation and an unactionable instruction: the player checks their wallet,
 * finds nothing amiss, and has no way to learn that the fix is their clock.
 *
 * Distinguishing them leaks nothing HERE, unlike on the reviewer route: the
 * appellant signs with their own key over a message naming their own wallet
 * and pool, both of which they already hold, and the appeal position itself
 * is served to them on an open GET. There is no oracle to build.
 */
export function appealSubmissionRefusal(
  a: AppealSubmission,
  nowMs: number,
  windowMs: number = REVIEW_SIGNATURE_WINDOW_MS
): SubmissionRefusal | null {
  try {
    if (!isCanonicalIsoInstant(a.signedAt)) return 'bad_timestamp';
    const t = Date.parse(a.signedAt);
    if (Math.abs(nowMs - t) > windowMs) return 'clock_skew';
    const signature = Uint8Array.from(Buffer.from(a.signature, 'base64'));
    if (signature.length !== 64) return 'bad_signature';
    return nacl.sign.detached.verify(
      canonicalAppealMessage({
        pool: a.pool,
        player: a.player,
        grounds: a.grounds,
        signedAt: a.signedAt,
      }),
      signature,
      base58Decode(a.player)
    )
      ? null
      : 'bad_signature';
  } catch {
    return 'bad_signature';
  }
}

/** The bare-boolean form: did this submission verify at all? */
export function verifyAppealSubmission(
  a: AppealSubmission,
  nowMs: number,
  windowMs: number = REVIEW_SIGNATURE_WINDOW_MS
): boolean {
  return appealSubmissionRefusal(a, nowMs, windowMs) === null;
}

/** The lodge as a log row: the player is the signer, the grounds ride in `criterion`. */
export function lodgeRow(a: AppealSubmission): Decision {
  return {
    pool: a.pool,
    player: a.player,
    action: 'appeal_lodged',
    criterion: a.grounds,
    decidedBy: a.player,
    decidedAt: a.signedAt,
    signature: a.signature,
  };
}

/**
 * Recheck one log row from the row alone plus the registry. Reviewer rows:
 * a member's signature over the review message. The lodge: the row's own
 * player's signature over the appeal message. Freshness is not re-checked
 * here — a historical row is by definition old; the server checked it when
 * it was accepted, and the row carries the instant.
 */
export function verifyRow(row: Decision, registry: ReviewerRegistry): boolean {
  try {
    const signature = Uint8Array.from(Buffer.from(row.signature, 'base64'));
    if (signature.length !== 64) return false;
    if (row.action === 'appeal_lodged') {
      if (row.decidedBy !== row.player) return false;
      return nacl.sign.detached.verify(
        canonicalAppealMessage({
          pool: row.pool,
          player: row.player,
          grounds: row.criterion,
          signedAt: row.decidedAt,
        }),
        signature,
        base58Decode(row.player)
      );
    }
    if (!REVIEWER_ACTIONS.has(row.action)) return false;
    if (!registry.members.includes(row.decidedBy)) return false;
    return nacl.sign.detached.verify(
      canonicalReviewMessage({
        pool: row.pool,
        player: row.player,
        action: row.action,
        criterion: row.criterion,
        signedAt: row.decidedAt,
      }),
      signature,
      base58Decode(row.decidedBy)
    );
  } catch {
    return false;
  }
}
