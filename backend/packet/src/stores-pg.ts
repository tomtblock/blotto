/**
 * The Postgres twins of the packet service's in-memory stores (E5
 * deployment wiring): D-B4 attestations and the D3 notify opt-in. Same
 * contracts, same verification order — the signature checks live in
 * attestations.ts / notify.ts and run BEFORE these stores see a row.
 */

import type { AttestationRecord, AttestationStore } from './attestations';
import type { NotifyPreferenceRecord, NotifyPreferenceStore } from './notify';
import type { PoolNotifyRecord, PoolNotifyStore, PoolStateFacts, PoolStateReader } from './notify-pool';

/** The same narrow query surface every other PG store uses. */
export interface Queryable {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: unknown[] }>;
}

export class PgAttestationStore implements AttestationStore {
  constructor(private readonly db: Queryable) {}

  async get(wallet: string): Promise<AttestationRecord | null> {
    const res = await this.db.query(
      `SELECT wallet, terms_version, attested_18, attested_at::text AS attested_at, wallet_signature
         FROM attestations WHERE wallet = $1`,
      [wallet]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0] as {
      wallet: string;
      terms_version: number;
      attested_at: string;
      wallet_signature: string;
    };
    return {
      wallet: r.wallet,
      termsVersion: r.terms_version,
      attested18: true,
      timestamp: BigInt(r.attested_at),
      walletSignature: r.wallet_signature,
    };
  }

  async put(record: AttestationRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO attestations (wallet, terms_version, attested_18, attested_at, wallet_signature)
       VALUES ($1, $2, TRUE, $3, $4)
       ON CONFLICT (wallet) DO UPDATE SET
         terms_version = EXCLUDED.terms_version,
         attested_at = EXCLUDED.attested_at,
         wallet_signature = EXCLUDED.wallet_signature`,
      [record.wallet, record.termsVersion, record.timestamp.toString(), record.walletSignature]
    );
  }
}

export class PgNotifyPreferenceStore implements NotifyPreferenceStore {
  constructor(private readonly db: Queryable) {}

  async get(wallet: string): Promise<NotifyPreferenceRecord | null> {
    const res = await this.db.query(
      `SELECT wallet, email_opt_in, signed_at::text AS signed_at, wallet_signature
         FROM notify_optin WHERE wallet = $1`,
      [wallet]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0] as {
      wallet: string;
      email_opt_in: boolean;
      signed_at: string;
      wallet_signature: string;
    };
    return {
      wallet: r.wallet,
      emailOptIn: r.email_opt_in,
      timestamp: BigInt(r.signed_at),
      walletSignature: r.wallet_signature,
    };
  }

  async put(record: NotifyPreferenceRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO notify_optin (wallet, email_opt_in, signed_at, wallet_signature)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (wallet) DO UPDATE SET
         email_opt_in = EXCLUDED.email_opt_in,
         signed_at = EXCLUDED.signed_at,
         wallet_signature = EXCLUDED.wallet_signature`,
      [record.wallet, record.emailOptIn, record.timestamp.toString(), record.walletSignature]
    );
  }
}

/**
 * The v2 opt-in rows (backend/_shared/migrations/0023_notify_pool_optin.sql).
 * `put` is an upsert that reopens the row — a newer signed message replaces
 * the older one and clears sent_at — and `markSent` sets sent_at and NULLs
 * the address in one statement, so no path leaves a delivered address
 * behind.
 */
export class PgPoolNotifyStore implements PoolNotifyStore {
  constructor(private readonly db: Queryable) {}

  private static row(r: {
    pool: string;
    wallet: string;
    email: string | null;
    signed_at: string;
    wallet_signature: string;
    sent_at: Date | string | null;
  }): PoolNotifyRecord {
    return {
      pool: r.pool,
      wallet: r.wallet,
      email: r.email,
      timestamp: BigInt(r.signed_at),
      walletSignature: r.wallet_signature,
      sentAt: r.sent_at === null ? null : new Date(r.sent_at),
    };
  }

  async get(pool: string, wallet: string): Promise<PoolNotifyRecord | null> {
    const res = await this.db.query(
      `SELECT pool, wallet, email, signed_at::text AS signed_at, wallet_signature, sent_at
         FROM notify_pool_optin WHERE pool = $1 AND wallet = $2`,
      [pool, wallet]
    );
    if (res.rows.length === 0) return null;
    return PgPoolNotifyStore.row(res.rows[0] as Parameters<typeof PgPoolNotifyStore.row>[0]);
  }

  async put(record: PoolNotifyRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO notify_pool_optin (pool, wallet, email, signed_at, wallet_signature, sent_at)
         VALUES ($1, $2, $3, $4, $5, NULL)
         ON CONFLICT (pool, wallet) DO UPDATE
           SET email = EXCLUDED.email,
               signed_at = EXCLUDED.signed_at,
               wallet_signature = EXCLUDED.wallet_signature,
               sent_at = NULL,
               received_at = now()`,
      [record.pool, record.wallet, record.email, record.timestamp.toString(), record.walletSignature]
    );
  }

  async pending(limit = 500): Promise<PoolNotifyRecord[]> {
    const res = await this.db.query(
      `SELECT pool, wallet, email, signed_at::text AS signed_at, wallet_signature, sent_at
         FROM notify_pool_optin
        WHERE sent_at IS NULL AND email IS NOT NULL
        ORDER BY received_at
        LIMIT $1`,
      [limit]
    );
    return (res.rows as Parameters<typeof PgPoolNotifyStore.row>[0][]).map(PgPoolNotifyStore.row);
  }

  async markSent(pool: string, wallet: string, at: Date): Promise<void> {
    await this.db.query(
      `UPDATE notify_pool_optin SET sent_at = $3, email = NULL WHERE pool = $1 AND wallet = $2`,
      [pool, wallet, at]
    );
  }
}

/** Pool states as the indexer projects them, read from the shared database. */
export class PgPoolStateReader implements PoolStateReader {
  constructor(private readonly db: Queryable) {}

  async states(pools: readonly string[]): Promise<Map<string, PoolStateFacts>> {
    const out = new Map<string, PoolStateFacts>();
    if (pools.length === 0) return out;
    const res = await this.db.query(`SELECT pool, id::text AS id, state FROM pools WHERE pool = ANY($1)`, [
      [...pools],
    ]);
    for (const r of res.rows as { pool: string; id: string | null; state: string | null }[]) {
      out.set(r.pool, { id: r.id, state: String(r.state ?? '') });
    }
    return out;
  }
}
