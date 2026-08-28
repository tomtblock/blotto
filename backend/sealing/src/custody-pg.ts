/**
 * The Postgres PublishedKeyStore (E5 deployment wiring) — the durable twin
 * of custody-turnkey.ts's MemoryPublishedKeyStore. All public data: the
 * pool key's public half, the hash the chain committed at open, and the
 * Turnkey private-key id the post-seal export addresses. A daemon restart
 * must find these rows or an open pool's key becomes unreachable — which
 * is exactly why the memory store is test-only.
 */

import type { Queryable } from './shared';
import type { PublishedKeyStore, StoredPublishedKey } from './custody-turnkey';

export class PgPublishedKeyStore implements PublishedKeyStore {
  constructor(private readonly db: Queryable) {}

  async save(poolId: bigint, record: StoredPublishedKey): Promise<void> {
    await this.db.query(
      `INSERT INTO published_pool_keys (pool_id, public_key_hex, secret_hash_hex, private_key_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (pool_id) DO NOTHING`,
      [poolId.toString(), record.publicKeyHex, record.secretHashHex, record.privateKeyId]
    );
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
