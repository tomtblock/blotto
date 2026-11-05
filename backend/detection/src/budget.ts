/**
 * The per-reviewer action budget (audit 2026-09-11, B-25).
 *
 * A reviewer key had no bound of any kind: one key could act on every entry
 * in every pool, as fast as it could sign. A budget does not stop a
 * determined holder of a valid key from doing harm — nothing short of a
 * second signer does — but it bounds the blast radius of a key that is being
 * used wrongly (stolen, scripted, or a page in a loop) to one window's
 * worth, and it makes the attempt LOUD rather than silent, which is the part
 * that matters: the alert is the control, the refusal only buys time.
 *
 * ── RATIFIED: 64 DECISIONS PER HOUR (D-E13, founder ruling 2026-09-13) ─────
 * {@link REVIEWER_ACTION_BUDGET} and {@link REVIEWER_ACTION_WINDOW_MS} were
 * architect proposals carrying AWAITING_RATIFICATION until 2026-09-13, when
 * the founder ratified both unchanged. They are how many signed decisions one
 * reviewer may make in a window, which is a policy about how the operator
 * reviews — the founder's column, not the architect's. Both stay env-
 * overridable and are reached ONLY as defaults, never inlined at a use site.
 *
 * The founder's question at ratification was whether this could impede a
 * process meant to run autonomously. It cannot, and the reasoning is worth
 * keeping here: in an autonomous run NOBODY SIGNS ANYTHING. Detection acts on
 * nothing (`pipeline.ts`, D-E9), a prize is held only by a reviewer's signed
 * decision, and an unanswered flag clears itself after the 12-hour window and
 * pays. The budget is reached only by a key that is signing decisions faster
 * than a person reviews, which is the case it exists to catch.
 *
 * The derivation, kept because a ratified number still has to be defensible
 * — RE-DERIVED for the Ladder (D-E19, 2026-11-05), because the one it
 * replaced reasoned from a single 64-seat pool and that is no longer the
 * worst honest moment:
 *
 *   WHAT A DECISION CAN ACT ON. A decision is a flag, a clear, a release or a
 *   forfeit on one entry (`preconditions.ts`). A flag only matters on a seat
 *   that will be PAID — it holds that seat's prize in escrow — and a release
 *   or forfeit exists only for a seat that was paid into escrow. So the
 *   honest review work at one moment is bounded by the paid places of every
 *   pool that is live at that moment, not by its seats.
 *
 *   HOW MANY POOLS ARE LIVE AT ONCE. Since D-E19 one pool per pool type
 *   (mode × tier × size) can be live, all at the same time. The devnet
 *   launch enables eight: both modes × the four sizes at tier 0.
 *
 *     paid places per mode  =  2 + 4 + 8 + 16   (8, 16, 32, 64 seats: the
 *                                                top quarter is paid)
 *                           =  30
 *     paid places, launch   =  2 modes × 30     =  60
 *     seats, launch         =  2 × (8 + 16 + 32 + 64)  =  240
 *
 *   AGAINST 64 PER HOUR:
 *     - every paid place of all eight launch pools flagged inside one hour
 *       is 60 decisions — under the budget, with 4 to spare;
 *     - flagging AND deciding each of them in the same hour is 120 — over
 *       it: the second half waits for the next window;
 *     - a decision on every seat (240) was never honest review work and
 *       stays far over it.
 *   A tie that straddles the paid line (D3-B) can pay a few more seats than
 *   the table has places; the margin of 4 absorbs a small one, not a large
 *   one. And each further (mode, tier) the founder enables adds 30 paid
 *   places: with a second tier on both modes the honest worst case (120)
 *   is past the budget in one window.
 *
 *   Detection is manual (D-E9) and a flag is a considered human act, so real
 *   traffic is units per pool, not dozens — the figures above are the
 *   extremes, not the expectation. 64 / hour stays about two orders of
 *   magnitude below what a script can do with a stolen key in the same
 *   hour, and an hour is long enough that an operator answering an alert is
 *   looking at a window that has not already closed.
 *
 *   The cost of the bound being too tight is a 429 and a second window — a
 *   review decision is never time-critical to the minute, because the
 *   daemon's release clock runs in hours (the 12-hour review window) and the
 *   appeal windows in days. The cost of it being too loose is that a key that
 *   has gone wrong gets further before anyone sees it.
 *
 * PHASE-N-REVIEW: 64 is kept (D-E13 is the founder's number); it covers the
 * launch's 60 paid places once per hour but not a flag-and-decide of each,
 * nor more enabled tiers — raising it is the founder's call, not this file's.
 *
 * The count is taken from the decision log itself: every accepted decision is
 * a row signed by that key, so the log IS the budget's ledger and there is no
 * second store to keep consistent with it.
 */

/**
 * Decisions one reviewer key may sign per window — RATIFIED at 64 (D-E13,
 * founder ruling 2026-09-13): one 64-seat pool's worth of seats when it was
 * set, and since the Ladder the paid places of all eight launch pool types
 * (60) once each per hour — see the derivation above.
 */
export const REVIEWER_ACTION_BUDGET = 64;

/** The budget window, ms — RATIFIED at one hour (D-E13, 2026-09-13). */
export const REVIEWER_ACTION_WINDOW_MS = 60 * 60 * 1000;

/** Env names for the two ratified numbers above. */
export const BUDGET_ENV = {
  actions: 'BLOTTO_REVIEW_ACTION_BUDGET',
  windowMs: 'BLOTTO_REVIEW_ACTION_WINDOW_MS',
} as const;

export interface ReviewerBudget {
  /** Decisions one key may sign per window. */
  actions: number;
  windowMs: number;
}

export const DEFAULT_REVIEWER_BUDGET: ReviewerBudget = {
  actions: REVIEWER_ACTION_BUDGET,
  windowMs: REVIEWER_ACTION_WINDOW_MS,
};

/**
 * The window's opening instant, as the ISO string the log is queried with.
 * A separate function so the route, the test and the alert all name the same
 * boundary.
 */
export function budgetWindowStart(nowMs: number, budget: ReviewerBudget): string {
  return new Date(nowMs - budget.windowMs).toISOString();
}

/** Seconds to advertise in `Retry-After` when the budget is spent. */
export function budgetRetryAfterSeconds(budget: ReviewerBudget): number {
  return Math.max(1, Math.ceil(budget.windowMs / 1000));
}
