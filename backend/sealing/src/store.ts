/**
 * The ciphertext store (roadmap 2.3): Postgres holds CIPHERTEXT ONLY.
 *
 * The store's type does not have a "plaintext" column, a debug accessor, or
 * a decrypt helper — decryption happens only in the reveal pipeline, only
 * after custody exports the secret, and custody refuses until seal. Keeping
 * plaintext out of this interface is the code-shaped version of the sealing
 * property; do not add a convenience that returns decrypted bytes here.
 */

import type { Queryable } from './shared';

export interface StoredCiphertext {
  poolId: bigint;
  /** The player's wallet, base58 — the row key alongside the pool. */
  player: string;
  /** The sealed box (epk ‖ box). Never plaintext. */
  ciphertext: Uint8Array;
  /** When the row landed (server clock), for ops only — scoring never reads it. */
  receivedAt: Date;
}

export interface CiphertextStore {
  /** Insert or overwrite the player's ciphertext for the pool (last write wins pre-seal). */
  put(poolId: bigint, player: string, ciphertext: Uint8Array): Promise<void>;
  /** Every ciphertext for the pool, in insertion order. */
  listForPool(poolId: bigint): Promise<StoredCiphertext[]>;
  get(poolId: bigint, player: string): Promise<StoredCiphertext | null>;
}

/** In-memory store for tests and the rehearsal harness. */
export class MemoryCiphertextStore implements CiphertextStore {
  private readonly rows = new Map<string, StoredCiphertext>();
  private seq = 0;

  async put(poolId: bigint, player: string, ciphertext: Uint8Array): Promise<void> {
    this.rows.set(`${poolId}:${player}`, {
      poolId,
      player,
      ciphertext: ciphertext.slice(),
      receivedAt: new Date(this.seq++),
    });
  }

  async listForPool(poolId: bigint): Promise<StoredCiphertext[]> {
    return [...this.rows.values()]
      .filter((r) => r.poolId === poolId)
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  }

  async get(poolId: bigint, player: string): Promise<StoredCiphertext | null> {
    return this.rows.get(`${poolId}:${player}`) ?? null;
  }
}

/**
 * Postgres store. Table (migration lives in backend/_shared/migrations):
 *
 *   CREATE TABLE sealed_entries (
 *     pool_id     NUMERIC  NOT NULL,
 *     player      TEXT     NOT NULL,
 *     ciphertext  BYTEA    NOT NULL,
 *     received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 *     PRIMARY KEY (pool_id, player)
 *   );
 */
export class PgCiphertextStore implements CiphertextStore {
  constructor(private readonly db: Queryable) {}

  async put(poolId: bigint, player: string, ciphertext: Uint8Array): Promise<void> {
    await this.db.query(
      `INSERT INTO sealed_entries (pool_id, player, ciphertext)
       VALUES ($1, $2, $3)
       ON CONFLICT (pool_id, player) DO UPDATE
         SET ciphertext = EXCLUDED.ciphertext, received_at = now()`,
      [poolId.toString(), player, Buffer.from(ciphertext)]
    );
  }

  async listForPool(poolId: bigint): Promise<StoredCiphertext[]> {
    const res = await this.db.query(
      `SELECT pool_id, player, ciphertext, received_at
         FROM sealed_entries WHERE pool_id = $1 ORDER BY received_at ASC`,
      [poolId.toString()]
    );
    return res.rows.map((r: any) => ({
      poolId: BigInt(r.pool_id),
      player: r.player,
      ciphertext: new Uint8Array(r.ciphertext),
      receivedAt: r.received_at,
    }));
  }

  async get(poolId: bigint, player: string): Promise<StoredCiphertext | null> {
    const res = await this.db.query(
      `SELECT pool_id, player, ciphertext, received_at
         FROM sealed_entries WHERE pool_id = $1 AND player = $2`,
      [poolId.toString(), player]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      poolId: BigInt(r.pool_id),
      player: r.player,
      ciphertext: new Uint8Array(r.ciphertext),
      receivedAt: r.received_at,
    };
  }
}
