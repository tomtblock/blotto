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
 * The derivation, kept because a ratified number still has to be defensible:
 *
 *   A pool holds at most 64 entries and runs with at least MIN_SEATS, which
 *   is 40 since R7-b (2026-09-12; it was 52 under D-E4, which is what this
 *   line used to cite). The bound below reasons from the CAPACITY end, so
 *   the floor moving does not change it. The largest
 *   HONEST burst of review work that can exist at one moment is therefore one
 *   pool's worth of entries, 64, and that is already an extreme: it is every
 *   seat in a pool flagged and decided by one person inside an hour.
 *   Detection is manual (D-E9) and a flag is a considered human act, so real
 *   traffic is units per pool, not dozens.
 *
 *   64 decisions / hour is thus roughly 1x the worst honest burst and about
 *   two orders of magnitude below what a script can do with a stolen key in
 *   the same hour. An hour is also long enough that an operator answering an
 *   alert is looking at a window that has not already closed.
 *
 *   The cost of the bound being too tight is a 429 and a second window — a
 *   review decision is never time-critical to the minute, because the
 *   daemon's release clock runs in hours (the 12-hour review window) and the
 *   appeal windows in days. The cost of it being too loose is that a key that
 *   has gone wrong gets further before anyone sees it.
 *
 * The count is taken from the decision log itself: every accepted decision is
 * a row signed by that key, so the log IS the budget's ledger and there is no
 * second store to keep consistent with it.
 */

/**
 * Decisions one reviewer key may sign per window — RATIFIED at 64, one
 * pool's worth of seats (D-E13, founder ruling 2026-09-13).
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
