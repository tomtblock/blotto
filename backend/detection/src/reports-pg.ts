/**
 * The Postgres detection report store (A-18; migration 0021) — the durable
 * `DetectionReportStore` the settlement daemon writes and the reviewer
 * surface reads. Append-only, like the decision log beside it: `save` only
 * ever INSERTs, and there is no update and no delete in this module.
 *
 * The report body is stored as `jsonb` verbatim, so a threshold change in
 * `signals.ts` needs no migration and an old row still reads back as what
 * that run actually said rather than as what today's rules would say.
 */

import type { Queryable } from '../../_shared/src';
import type { Finding } from './signals';
import type { DetectionReportStore, StoredDetectionReport } from './reports';

export class PgDetectionReportStore implements DetectionReportStore {
  constructor(private readonly db: Queryable) {}

  async save(r: StoredDetectionReport): Promise<void> {
    await this.db.query(
      `INSERT INTO detection_reports
         (pool, pool_id, produced_at, findings, review_recommended, hard_blocks)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        r.pool,
        r.poolId,
        r.producedAt,
        JSON.stringify(r.report.findings),
        JSON.stringify(r.report.reviewRecommended),
        JSON.stringify(r.report.hardBlocks),
      ]
    );
  }

  async latest(pool: string): Promise<StoredDetectionReport | null> {
    const res = await this.db.query(
      `SELECT pool, pool_id, produced_at, findings, review_recommended, hard_blocks
         FROM detection_reports
        WHERE pool = $1
        ORDER BY produced_at DESC, id DESC
        LIMIT 1`,
      [pool]
    );
    const row = res.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) return null;
    return {
      pool: String(row.pool),
      poolId: String(row.pool_id),
      // A TIMESTAMPTZ comes back as a Date; this one is a display and
      // ordering value that no signature covers, so normalising it is safe
      // here in a way it is NOT in the decision log (see log-pg.ts).
      producedAt: new Date(row.produced_at as string | number | Date).toISOString(),
      report: {
        pool: String(row.pool),
        findings: asJsonArray<Finding>(row.findings),
        reviewRecommended: asJsonArray<string>(row.review_recommended),
        hardBlocks: asJsonArray<string>(row.hard_blocks),
      },
    };
  }
}

/** `jsonb` arrives parsed from `pg`; a text column would not. Tolerate both. */
function asJsonArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === 'string') {
    try {
      const parsed: unknown = JSON.parse(v);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}
