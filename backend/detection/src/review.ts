/**
 * The review decision log (roadmap 4.4): every clear/forfeit decision on a
 * flagged entry is recorded — who decided, when, why — and applied through
 * the settlement seam. The review PAGE renders this; the criteria the
 * decisions cite are published (rules page, Phase 6 copy).
 *
 * The chain actions `flag_entry`, `clear_flag` and `release_escrow` are the
 * settlement signer's; the seam here is deliberately narrow — a review
 * backend holds no other authority. `forfeit_escrow` is ADMIN-signed since
 * 2026-09-07 (prompt v2 §E.2 — taking a prize away is a multi-party act):
 * the review server holds no admin key, so a `forfeit` decision through
 * this seam fails loudly on chain and is landed by the operator with
 * `scripts/admin.ts forfeit-escrow` (a Squads proposal on mainnet). The
 * signed decision row is still the review's record either way — since
 * Stage E it is written FIRST for a forfeit (see `decide`), because the
 * published promise is that every decision is in the log, and the operator
 * landing the instruction later is execution, not decision.
 *
 * APPEALS (Phase 2 Stage E) live in the same log under three more action
 * kinds, so "every decision is published in a signed log" stays one log:
 *
 *   appeal_lodged     — signed by the PLAYER, not a reviewer: `decidedBy`
 *                       is the appellant's wallet, `criterion` carries the
 *                       grounds, and the signature is over
 *                       `canonicalAppealMessage` (appeal-message.ts), never
 *                       the review message. Accepted only against an
 *                       upheld flag (a `forfeit` row) within the published
 *                       seven days of it.
 *   appeal_upheld,
 *   appeal_dismissed  — signed by a reviewer who is NOT the reviewer who
 *                       upheld the flag (the published "different
 *                       reviewer"), over the review message like any other
 *                       decision. No chain action: the program has no
 *                       un-forfeit, and a successful appeal after the share
 *                       has moved is the operator's published undertaking
 *                       to pay from its own funds — never a clawback.
 *
 * `appeals.ts` holds the state machine and the row verifier that rechecks
 * any row from the log alone.
 */

export interface ReviewActions {
  flagEntry(pool: string, player: string): Promise<void>;
  clearFlag(pool: string, player: string): Promise<void>;
  releaseEscrow(pool: string, player: string): Promise<void>;
  forfeitEscrow(pool: string, player: string): Promise<void>;
}

/**
 * One review decision — THE LOG FORMAT (C10). Every row is
 * self-verifying: `signature` is the reviewer's Ed25519 signature (base64)
 * over `canonicalReviewMessage({pool, player, action, criterion,
 * signedAt: decidedAt})` (auth.ts), verifiable against `decidedBy` (the
 * reviewer's base58 wallet key, a member of the admin multisig). Anyone
 * holding the log can recheck who decided what, when, and under which
 * published criterion — the reviewer is checkable, not trusted.
 */
export type DecisionAction =
  | 'flag'
  | 'clear'
  | 'release'
  | 'forfeit'
  | 'appeal_lodged'
  | 'appeal_upheld'
  | 'appeal_dismissed';

/** The reviewer-signed kinds (the review message); `appeal_lodged` is the
 * one player-signed kind (the appeal message). */
export const REVIEWER_ACTIONS: ReadonlySet<DecisionAction> = new Set([
  'flag',
  'clear',
  'release',
  'forfeit',
  'appeal_upheld',
  'appeal_dismissed',
]);

export interface Decision {
  /** Pool PDA, base58. */
  pool: string;
  /** The entry's player wallet, base58. */
  player: string;
  action: DecisionAction;
  /** Which published criterion the decision cites. */
  criterion: string;
  /** The reviewer's wallet (base58) — the signature's verifying key. */
  decidedBy: string;
  /** ISO timestamp — the same instant the signature covers. */
  decidedAt: string;
  /** Base64 Ed25519 signature over the canonical decision message. */
  signature: string;
}

export interface DecisionLog {
  append(d: Decision): Promise<void>;
  list(pool: string): Promise<Decision[]>;
  /** One entry's thread, oldest first — what the appeal rules read. */
  listFor(pool: string, player: string): Promise<Decision[]>;
}

export class MemoryDecisionLog implements DecisionLog {
  private rows: Decision[] = [];
  async append(d: Decision): Promise<void> {
    this.rows.push({ ...d });
  }
  async list(pool: string): Promise<Decision[]> {
    return this.rows.filter((r) => r.pool === pool).map((r) => ({ ...r }));
  }
  async listFor(pool: string, player: string): Promise<Decision[]> {
    return this.rows
      .filter((r) => r.pool === pool && r.player === player)
      .map((r) => ({ ...r }));
  }
}

/**
 * What `decide` did. `applied`: the chain action landed (or none was due)
 * and the row is logged. `recorded_pending_admin`: a FORFEIT whose row is
 * logged but whose instruction this service cannot sign — the operator
 * lands it with the admin key; the log already says review upheld the flag.
 */
export type DecideOutcome = 'applied' | 'recorded_pending_admin';

/**
 * Apply one review decision.
 *
 * Order differs by kind, deliberately:
 *   - flag / clear / release: CHAIN THEN LOG. A refused action logs nothing,
 *     so the log never claims a release that did not happen.
 *   - forfeit: LOG THEN CHAIN. The decision is the reviewer's signed row;
 *     landing `forfeit_escrow` is admin-signed and usually happens later
 *     from `scripts/admin.ts`. Until 2026-09-07 the chain-first order meant
 *     a forfeit through this service was NEVER logged (the chain call
 *     always threw here), which broke the published promise that every
 *     decision is in the log.
 *   - appeal_*: LOG ONLY. There is no chain action an appeal can take.
 */
export async function decide(
  actions: ReviewActions,
  log: DecisionLog,
  d: Decision
): Promise<DecideOutcome> {
  switch (d.action) {
    case 'flag':
      await actions.flagEntry(d.pool, d.player);
      break;
    case 'clear':
      await actions.clearFlag(d.pool, d.player);
      break;
    case 'release':
      await actions.releaseEscrow(d.pool, d.player);
      break;
    case 'forfeit': {
      await log.append(d);
      try {
        await actions.forfeitEscrow(d.pool, d.player);
        return 'applied';
      } catch {
        return 'recorded_pending_admin';
      }
    }
    case 'appeal_lodged':
    case 'appeal_upheld':
    case 'appeal_dismissed':
      break;
  }
  await log.append(d);
  return 'applied';
}
