/**
 * The Postgres decision log (C10) — the durable `DecisionLog` behind the
 * review server. Append-only by construction: there is no update and no
 * delete here, and the table carries no primary key a row could be
 * replaced under — a decision, once made, stays on the record (a reversal
 * is a NEW decision citing its criterion). Row format per `review.ts`.
 */

import type { Queryable } from '../../_shared/src';
import type { Decision, DecisionLog } from './review';

export class PgDecisionLog implements DecisionLog {
  constructor(private readonly db: Queryable) {}

  async append(d: Decision): Promise<void> {
    await this.db.query(
      `INSERT INTO review_decisions
         (pool, player, action, criterion, decided_by, decided_at, signature)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [d.pool, d.player, d.action, d.criterion, d.decidedBy, d.decidedAt, d.signature]
    );
  }

  async list(pool: string): Promise<Decision[]> {
    const res = await this.db.query(
      `SELECT pool, player, action, criterion, decided_by, decided_at, signature
         FROM review_decisions
        WHERE pool = $1
        ORDER BY decided_at, decided_by`,
      [pool]
    );
    return res.rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        pool: String(row.pool),
        player: String(row.player),
        action: String(row.action) as Decision['action'],
        criterion: String(row.criterion),
        decidedBy: String(row.decided_by),
        decidedAt: new Date(String(row.decided_at)).toISOString(),
        signature: String(row.signature),
      };
    });
  }
}
