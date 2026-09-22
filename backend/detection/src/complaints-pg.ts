/**
 * The Postgres complaints store (2026-09-19) — the durable `ComplaintStore`
 * behind the review server's `/complaints` routes.
 *
 * Append-only by construction, like `log-pg.ts`: there is no update and no
 * delete here. An operator moving a complaint to acknowledged or resolved
 * appends a row; the status a player is shown is derived from the thread
 * (`complaints.ts::complaintStatus`), so the history of a complaint cannot be
 * quietly rewritten.
 *
 * `signed_at` is stored and served as TEXT, verbatim. That is migration
 * 0020's lesson (audit A-04 / B-21) applied before it can bite: `pg` returns
 * a TIMESTAMPTZ as a `Date`, whose string form carries no sub-second field,
 * so a signed instant round-tripped through a timestamp column comes back
 * truncated and the signature over it no longer verifies. The signature
 * covers the STRING, so the string is what the table holds.
 */

import type { Queryable } from '../../_shared/src';
import type { ComplaintCategory, ComplaintRow, ComplaintStore } from './complaints';

/** The columns a `ComplaintRow` is built from — one list, used by every read. */
const ROW_COLUMNS = `reference, kind, wallet, category, pool, body, signature, signed_at, decided_by, received_at`;

function toRow(row: Record<string, unknown>): ComplaintRow {
  return {
    reference: String(row.reference),
    kind: String(row.kind) as ComplaintRow['kind'],
    wallet: row.wallet === null || row.wallet === undefined ? null : String(row.wallet),
    category: String(row.category) as ComplaintCategory,
    pool: row.pool === null || row.pool === undefined ? null : String(row.pool),
    body: String(row.body),
    signature: row.signature === null || row.signature === undefined ? null : String(row.signature),
    signedAt: row.signed_at === null || row.signed_at === undefined ? null : String(row.signed_at),
    decidedBy:
      row.decided_by === null || row.decided_by === undefined ? null : String(row.decided_by),
    receivedAt: new Date(String(row.received_at)).toISOString(),
  };
}

export class PgComplaintStore implements ComplaintStore {
  constructor(private readonly db: Queryable) {}

  async append(row: ComplaintRow): Promise<void> {
    await this.db.query(
      `INSERT INTO complaints
         (reference, kind, wallet, category, pool, body, signature, signed_at, decided_by, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        row.reference,
        row.kind,
        row.wallet,
        row.category,
        row.pool,
        row.body,
        row.signature,
        row.signedAt,
        row.decidedBy,
        row.receivedAt,
      ]
    );
  }

  async listFor(reference: string): Promise<ComplaintRow[]> {
    const res = await this.db.query(
      `SELECT ${ROW_COLUMNS}
         FROM complaints
        WHERE reference = $1
        ORDER BY id`,
      [reference]
    );
    return res.rows.map(toRow);
  }
}
