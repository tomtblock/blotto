/**
 * The Postgres PublishedKeyStore (E5 deployment wiring) — the durable twin
 * of custody-turnkey.ts's MemoryPublishedKeyStore. All public data: the
 * pool key's public half, the hash the chain committed at open, and the
 * Turnkey private-key id the post-seal export addresses. A daemon restart
 * must find these rows or an open pool's key becomes unreachable — which
 * is exactly why the memory store is test-only.
 *
 * `save` is the concurrency barrier for a pool's sealing key (audit
 * 2026-09-11, B-29). `PublishedKeyStore.save` in custody-turnkey.ts carries
 * the full reasoning; the short version is that this statement used to be
 * `ON CONFLICT (pool_id) DO NOTHING`, so a second concurrent open of the
 * same pool was told its key had been stored when it had not. That caller
 * would then open the pool on chain committing a hash whose secret custody
 * can never export, and every entry sealed to that pool would be
 * permanently unreadable.
 */

import type { Queryable } from './shared';
import {
  PublishedKeyConflictError,
  samePublishedKey,
  type PublishedKeyStore,
  type StoredPublishedKey,
} from './custody-turnkey';

export class PgPublishedKeyStore implements PublishedKeyStore {
  constructor(private readonly db: Queryable) {}

  /**
   * First write wins; a conflicting second write throws
   * `PublishedKeyConflictError`; an identical re-save is a no-op.
   *
   * `ON CONFLICT DO NOTHING ... RETURNING` returns exactly one row when THIS
   * statement inserted and zero rows when it did not, which is the signal we
   * need and is defined by the statement itself rather than by whether a
   * particular driver or test double populates `rowCount`. The insert is
   * atomic against a concurrent writer, so the row that comes back from the
   * follow-up read is the one that won.
   */
  async save(poolId: bigint, record: StoredPublishedKey): Promise<void> {
    const inserted = await this.db.query(
      `INSERT INTO published_pool_keys (pool_id, public_key_hex, secret_hash_hex, private_key_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (pool_id) DO NOTHING
       RETURNING pool_id`,
      [poolId.toString(), record.publicKeyHex, record.secretHashHex, record.privateKeyId]
    );
    if (inserted.rows.length > 0) return;

    const existing = await this.load(poolId);
    if (!existing) {
      // The insert was refused by a conflict and the row is not there on the
      // next read. That is not a concurrency outcome this table can produce
      // (nothing deletes from it), so something else is wrong — a wrong
      // database, a truncated table mid-flight — and the caller must not
      // proceed as though its key were stored.
      throw new Error(
        `pool ${poolId}: the sealing key insert conflicted but no row could be read back — ` +
          `refusing to report a key as published when it is not`
      );
    }
    if (samePublishedKey(existing, record)) return;
    throw new PublishedKeyConflictError(poolId, existing, record);
  }

  async load(poolId: bigint): Promise<StoredPublishedKey | null> {
    const res = await this.db.query(
      `SELECT public_key_hex, secret_hash_hex, private_key_id
         FROM published_pool_keys WHERE pool_id = $1`,
      [poolId.toString()]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0] as {
      public_key_hex: string;
      secret_hash_hex: string;
      private_key_id: string;
    };
    return {
      publicKeyHex: r.public_key_hex,
      secretHashHex: r.secret_hash_hex,
      privateKeyId: r.private_key_id,
    };
  }
}
