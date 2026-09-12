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

/**
 * The settlement seam, plus the two READS the preconditions need.
 *
 * The reads are part of this interface rather than a second injected seam on
 * purpose (audit B-25): a service wired with the write half and not the read
 * half would fall back to acting with no precondition at all, which is the
 * finding. One seam means the compiler asks for both.
 */
export interface ReviewActions {
  flagEntry(pool: string, player: string): Promise<void>;
  clearFlag(pool: string, player: string): Promise<void>;
  releaseEscrow(pool: string, player: string): Promise<void>;
  forfeitEscrow(pool: string, player: string): Promise<void>;
  /** The pool's state name, for the pool-level precondition. */
  poolState(pool: string): Promise<ReviewPoolState>;
  /** The entry's position, or null when this wallet has no entry in this pool. */
  entryState(pool: string, player: string): Promise<ReviewEntryState | null>;
}

/** Pool states as the program names them (`reveal/src/chain.ts`). */
export type ReviewPoolState =
  | 'Open'
  | 'Sealed'
  | 'Scored'
  | 'Paid'
  | 'Refunding'
  | 'Closed';

/**
 * The entry fields every review precondition reads — the subset of
 * `ChainEntryView` (`reveal/src/chain.ts`) that the program's own `require!`
 * lines in `flags.rs` and `escrow.rs` are written over.
 */
export interface ReviewEntryState {
  flagged: boolean;
  settled: boolean;
  forfeited: boolean;
  sanctionsHold: boolean;
  escrowLamports: bigint;
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
  /**
   * How many rows this signing key has on the record at or after `sinceIso`
   * — the per-reviewer action budget (audit B-25). Counts every kind of row
   * the key signed; a player's own appeal lodge is signed by the player, so
   * it never counts against a reviewer's budget.
   */
  countBy(decidedBy: string, sinceIso: string): Promise<number>;
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
  async countBy(decidedBy: string, sinceIso: string): Promise<number> {
    const since = Date.parse(sinceIso);
    return this.rows.filter(
      (r) => r.decidedBy === decidedBy && Date.parse(r.decidedAt) >= since
    ).length;
  }
}

/**
 * What `decide` did.
 *
 *   `applied`              the chain action landed (or none was due) and the
 *                          row is logged. The only wholly clean outcome.
 *   `applied_not_logged`   THE CHAIN ACTION LANDED AND THE LOG WRITE FAILED
 *                          (audit B-24). Irreversible work happened; the
 *                          record of it did not. The caller must be told the
 *                          action executed — telling a reviewer "502, it
 *                          failed" about work that is already on chain
 *                          invites a retry of something already done — and
 *                          must alert, because a decision missing from the
 *                          published log breaks the promise that every
 *                          decision is in it.
 *   `recorded_pending_admin`
 *                          a FORFEIT whose row is logged but whose
 *                          instruction this service cannot sign — the
 *                          operator lands it with the admin key. `chainError`
 *                          carries WHY the call did not land: this service
 *                          holding no admin key is the expected reason, an
 *                          RPC outage is not, and until 2026-09-12 the two
 *                          were indistinguishable because the error was
 *                          swallowed whole (audit C-07).
 */
export type DecideOutcomeKind = 'applied' | 'applied_not_logged' | 'recorded_pending_admin';

export interface DecideOutcome {
  kind: DecideOutcomeKind;
  /** Why the chain call did not land, when one was attempted and refused. */
  chainError?: string;
  /** Why the log write failed, on `applied_not_logged`. */
  logError?: string;
}

/**
 * Apply one review decision.
 *
 * Order differs by kind, deliberately:
 *   - flag / clear / release: CHAIN THEN LOG. A refused action logs nothing
 *     and THROWS, so the log never claims a release that did not happen and
 *     the caller answers 502. A log write that fails AFTER the chain action
 *     landed does not throw: the chain is the irreversible half, so the
 *     outcome says `applied_not_logged` and the caller reports the truth.
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
        return { kind: 'applied' };
      } catch (e) {
        // NOT swallowed (audit C-07). "This service holds no admin key" and
        // "the RPC is down" produce the same outcome here — the operator
        // lands it either way — but only one of them is routine, and the
        // caller and the alert both need to be able to tell them apart.
        return { kind: 'recorded_pending_admin', chainError: errorText(e) };
      }
    }
    case 'appeal_lodged':
    case 'appeal_upheld':
    case 'appeal_dismissed':
      break;
  }
  try {
    await log.append(d);
  } catch (e) {
    // The chain action (if any) has already landed. An appeal row reaches
    // here too: nothing happened on chain, so a failed write is a plain
    // failure and is re-thrown for the caller's 502.
    if (d.action === 'flag' || d.action === 'clear' || d.action === 'release') {
      return { kind: 'applied_not_logged', logError: errorText(e) };
    }
    throw e;
  }
  return { kind: 'applied' };
}

/** An error's message, never its stack — these strings reach a response body. */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
