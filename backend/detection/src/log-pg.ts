/**
 * The Postgres decision log (C10) — the durable `DecisionLog` behind the
 * review server. Append-only by construction: there is no update and no
 * delete here, and the table carries no primary key a row could be
 * replaced under — a decision, once made, stays on the record (a reversal
 * is a NEW decision citing its criterion). Row format per `review.ts`.
 *
 * THE SIGNED TIMESTAMP IS TEXT, AND IS SERVED BACK AS TEXT (audit
 * 2026-09-11, A-04 / B-21; migration 0020). Until 2026-09-12 this module
 * reconstructed `decidedAt` from the `TIMESTAMPTZ` column:
 *
 *     decidedAt: new Date(String(row.decided_at)).toISOString()
 *
 * `pg` returns a TIMESTAMPTZ as a JavaScript `Date`, and `String(date)`
 * formats it with no sub-second field at all — so every signature's
 * timestamp came back truncated to whole seconds, and NO row this log
 * served re-verified against the signature that authorised it. The
 * canonical message ends `at: <decidedAt>`: the signature covers the
 * STRING, so the string is what the log has to hold and hand back.
 * `decided_at` stays for ordering and for the budget window; nothing reads
 * it back into a row.
 */

import type { Queryable } from '../../_shared/src';
import type { Decision, DecisionLog } from './review';

/** The columns a `Decision` is built from — one list, used by all three reads. */
const ROW_COLUMNS = `pool, player, action, criterion, decided_by, decided_at_text, signature`;

export class PgDecisionLog implements DecisionLog {
  constructor(private readonly db: Queryable) {}

  async append(d: Decision): Promise<void> {
    // The signed instant is sent TWICE, as two parameters rather than one
    // reused: `$6` lands in a TIMESTAMPTZ and `$7` in TEXT, and a single
    // parameter used in both places would be type-inferred from its first
    // context and then refused by the second.
    await this.db.query(
      `INSERT INTO review_decisions
         (pool, player, action, criterion, decided_by, decided_at, decided_at_text, signature)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        d.pool,
        d.player,
        d.action,
        d.criterion,
        d.decidedBy,
        d.decidedAt,
        d.decidedAt,
        d.signature,
      ]
    );
  }

  async list(pool: string): Promise<Decision[]> {
    const res = await this.db.query(
      `SELECT ${ROW_COLUMNS}
         FROM review_decisions
        WHERE pool = $1
        ORDER BY decided_at, decided_by`,
      [pool]
    );
    return res.rows.map(rowToDecision);
  }

  /** One entry's thread (Stage E) — served by the (pool, player) index of 0015. */
  async listFor(pool: string, player: string): Promise<Decision[]> {
    const res = await this.db.query(
      `SELECT ${ROW_COLUMNS}
         FROM review_decisions
        WHERE pool = $1 AND player = $2
        ORDER BY decided_at, id`,
      [pool, player]
    );
    return res.rows.map(rowToDecision);
  }

  /**
   * How many rows this key has signed since `sinceIso` — the per-reviewer
   * action budget's only question (audit B-25). Counted on the INSTANT
   * column, which is indexed for it by migration 0020; the budget is a rate,
   * so the instant is the right reading of the row even though the signature
   * covers the text.
   */
  async countBy(decidedBy: string, sinceIso: string): Promise<number> {
    const res = await this.db.query(
      `SELECT COUNT(*)::bigint AS n
         FROM review_decisions
        WHERE decided_by = $1 AND decided_at >= $2`,
      [decidedBy, sinceIso]
    );
    const row = res.rows[0] as { n?: unknown } | undefined;
    return row === undefined ? 0 : Number(row.n ?? 0);
  }
}

function rowToDecision(r: unknown): Decision {
  const row = r as Record<string, unknown>;
  return {
    pool: String(row.pool),
    player: String(row.player),
    action: String(row.action) as Decision['action'],
    criterion: String(row.criterion),
    decidedBy: String(row.decided_by),
    // VERBATIM — never reformatted, never round-tripped through a Date.
    decidedAt: String(row.decided_at_text),
    signature: String(row.signature),
  };
}
