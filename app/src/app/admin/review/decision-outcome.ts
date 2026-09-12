/*
 * What a review decision's response MEANS (audit 2026-09-11, B-24 / B-25).
 *
 * The page used to read `res.ok` as success. The review service has since
 * grown an outcome where that is exactly wrong, and it is the one that
 * matters most:
 *
 *   200 { applied: true, logged: false } — THE CHAIN ACTION LANDED AND THE
 *   PUBLISHED LOG DOES NOT SAY SO.
 *
 * Read as success, a reviewer moves on believing the decision is on the
 * record; read as failure, they repeat work that is already irreversible.
 * It is neither, and it needs an operator, so it gets its own state and its
 * own sentence. The service's own header calls this "an operator problem,
 * loudly" — this is the loud part on the page.
 *
 * Also named here: the 429 action budget (B-25), which used to render as a
 * bare "failed: 429", and each 409 precondition refusal
 * (`backend/detection/src/preconditions.ts`), which used to render as its
 * raw code.
 *
 * Pure, so every branch is pinned without a network or a DOM.
 *
 * Admin surface: raw strings by design, like the page it serves — the COPY
 * module owns player-facing language only.
 */

/**
 * `severity` drives how the page draws it, and is not cosmetic:
 *  - `ok`        the decision is done and recorded.
 *  - `attention` something landed that needs a human next: the admin still
 *                has to land a forfeit, or the log needs repair.
 *  - `refused`   nothing happened, and the reason is a rule.
 *  - `failed`    nothing is known to have happened; the service or the
 *                chain could not be reached.
 */
export type DecisionSeverity = 'ok' | 'attention' | 'refused' | 'failed';

export interface DecisionOutcome {
  kind:
    | 'recorded'
    | 'applied_not_logged'
    | 'recorded_pending_admin'
    | 'not_a_reviewer'
    | 'budget_exceeded'
    | 'refused'
    | 'unreachable'
    | 'failed';
  severity: DecisionSeverity;
  message: string;
  /** True only when the decision is fully done — the page reloads on it. */
  settled: boolean;
}

/** The service's 409 rule refusals, in the operator's words rather than
 * the wire's. Every one mirrors a `require!` the program itself enforces,
 * so the sentence says what the chain would have said. */
const REFUSALS: Record<string, string> = {
  already_recorded:
    'refused: this exact decision is already on the record. Nothing was submitted twice.',
  no_entry: 'refused: this wallet has no entry in this pool.',
  pool_state: 'refused: the pool is not in a state where this decision can act.',
  entry_settled: 'refused: this seat has already settled, so a flag can no longer change anything.',
  flag_unchanged: 'refused: the entry is already in that state — the flag would not change.',
  no_escrow: 'refused: this entry holds no escrowed share to release or forfeit.',
  already_forfeited: 'refused: this entry’s share has already been forfeited.',
  sanctions_hold:
    'refused: a sanctions hold is on this entry. Lifting it is admin-signed, not a review decision.',
  forfeit_requires_flag:
    'refused: an entry must be flagged before its share can be forfeited — an unflagged share is only waiting on checks.',
};

/** The 502s: the service reached neither the chain nor a verdict. */
const UNREACHABLE: Record<string, string> = {
  state_unreadable:
    'not attempted: the chain could not be read, so the decision’s legality is unknown. Nothing was submitted.',
  action_failed:
    'failed: the chain action was refused or the RPC did not answer. Nothing was logged.',
};

const short = (player: string) => `${player.slice(0, 8)}…`;

/**
 * Classify one response. `body` is whatever the response carried (an empty
 * object when it carried nothing or could not be parsed).
 */
export function decisionOutcome(
  action: string,
  player: string,
  status: number,
  body: Record<string, unknown>
): DecisionOutcome {
  const who = `${action}: ${short(player)}`;

  if (status === 204) {
    return { kind: 'recorded', severity: 'ok', settled: true, message: `${who} recorded` };
  }

  if (status === 200) {
    // B-24. `applied: true, logged: false` — the chain moved, the published
    // record does not say so. NEVER success.
    if (body.applied === true && body.logged === false) {
      return {
        kind: 'applied_not_logged',
        severity: 'attention',
        settled: false,
        message:
          `${who} — THE ACTION LANDED ON-CHAIN BUT WAS NOT WRITTEN TO THE PUBLISHED LOG. ` +
          'Do not repeat it: it is already done and cannot be undone. The signed log is now ' +
          'missing this decision and needs an operator — check the service alert and the log ' +
          `store before deciding anything else.${detailOf(body)}`,
      };
    }
    // Any other 200 is an outcome this page does not know. Say so rather
    // than calling it success, which is how B-24 got its foothold.
    return {
      kind: 'failed',
      severity: 'failed',
      settled: false,
      message: `${who} — the service answered 200 with an outcome this page does not recognise.${detailOf(body)}`,
    };
  }

  if (status === 202) {
    return {
      kind: 'recorded_pending_admin',
      severity: 'attention',
      settled: true,
      message:
        `${who} recorded — the instruction has NOT landed. Land forfeit_escrow with ` +
        `scripts/admin.ts (admin key); it stays on the pending list until it does.${detailOf(body)}`,
    };
  }

  if (status === 401) {
    return {
      kind: 'not_a_reviewer',
      severity: 'refused',
      settled: false,
      message: 'refused: this wallet is not in the reviewer list, or the signature was stale.',
    };
  }

  if (status === 429) {
    // B-25: a per-reviewer action budget, not a rate limiter on the wire.
    const seconds = typeof body.retryAfterSeconds === 'number' ? body.retryAfterSeconds : null;
    return {
      kind: 'budget_exceeded',
      severity: 'refused',
      settled: false,
      message:
        'refused: this reviewer wallet has spent its action budget for the current window. ' +
        'Nothing was submitted' +
        (seconds === null ? '.' : `; the window reopens in about ${formatWait(seconds)}.`) +
        ' The operator has been alerted.',
    };
  }

  if (status === 409) {
    const code = typeof body.error === 'string' ? body.error : '';
    return {
      kind: 'refused',
      severity: 'refused',
      settled: false,
      message: REFUSALS[code] ?? `refused: ${code || 'rule'}`,
    };
  }

  if (status === 502) {
    const code = typeof body.error === 'string' ? body.error : '';
    return {
      kind: 'unreachable',
      severity: 'failed',
      settled: false,
      message: (UNREACHABLE[code] ?? `failed: ${code || 'upstream'}`) + detailOf(body),
    };
  }

  if (status === 503) {
    return {
      kind: 'failed',
      severity: 'failed',
      settled: false,
      message: 'failed: the review service is not configured for this action.',
    };
  }

  return {
    kind: 'failed',
    severity: 'failed',
    settled: false,
    message: `failed: ${status}`,
  };
}

function detailOf(body: Record<string, unknown>): string {
  const detail = body.detail;
  return typeof detail === 'string' && detail ? ` (${detail})` : '';
}

function formatWait(seconds: number): string {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))}s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 90 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
}
