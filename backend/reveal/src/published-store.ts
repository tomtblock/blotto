/**
 * Where the daemon remembers which settled pools already have a published
 * reveal bundle (audit 2026-09-11, C-09 / B-32 / D-27).
 *
 * The crank is stateless by design — every step re-reads the chain — but the
 * chain carries no bundle URI and the program emits no bundle event, so
 * "already published" was a fact nothing could read: a resumed settlement
 * uploaded the bundle again, and a pool whose upload failed after payment
 * was never retried. This store is the missing memory: one row per pool,
 * written right after a successful upload (migration 0016). The crank asks
 * it before publishing; the daemon treats a Paid pool with no row as still
 * owing its bundle and retries on a later tick.
 *
 * A crash between the upload and the row costs one duplicate upload on the
 * next attempt — the archive keeps the newest tagged object, so a duplicate
 * is a cost, never a correctness fault.
 */

import type { Queryable } from '../../_shared/src/db';

export interface PublishedBundleStore {
  /** The published URI for a pool, or null when no upload is on record. */
  find(poolId: bigint): Promise<string | null>;
  /** Record a successful upload. A second record for the same pool is ignored. */
  record(poolId: bigint, uri: string, publishedAtUnix: bigint): Promise<void>;
}

/** The deployment store over the shared Postgres (table `published_bundles`). */
export class PgPublishedBundleStore implements PublishedBundleStore {
  constructor(private readonly db: Queryable) {}

  async find(poolId: bigint): Promise<string | null> {
    const res = await this.db.query(`SELECT uri FROM published_bundles WHERE pool_id = $1`, [
      poolId.toString(),
    ]);
    if (res.rows.length === 0) return null;
    return (res.rows[0] as { uri: string }).uri;
  }

  async record(poolId: bigint, uri: string, publishedAtUnix: bigint): Promise<void> {
    await this.db.query(
      `INSERT INTO published_bundles (pool_id, uri, published_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (pool_id) DO NOTHING`,
      [poolId.toString(), uri, publishedAtUnix.toString()]
    );
  }
}

/** The in-memory twin for tests and the offline rehearsal. */
export class MemoryPublishedBundleStore implements PublishedBundleStore {
  readonly rows = new Map<string, { uri: string; publishedAtUnix: bigint }>();

  async find(poolId: bigint): Promise<string | null> {
    return this.rows.get(poolId.toString())?.uri ?? null;
  }

  async record(poolId: bigint, uri: string, publishedAtUnix: bigint): Promise<void> {
    if (!this.rows.has(poolId.toString())) {
      this.rows.set(poolId.toString(), { uri, publishedAtUnix });
    }
  }
}
