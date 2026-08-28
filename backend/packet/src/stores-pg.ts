/**
 * The Postgres twins of the packet service's in-memory stores (E5
 * deployment wiring): D-B4 attestations and the D3 notify opt-in. Same
 * contracts, same verification order — the signature checks live in
 * attestations.ts / notify.ts and run BEFORE these stores see a row.
 */

import type { AttestationRecord, AttestationStore } from './attestations';
import type { NotifyPreferenceRecord, NotifyPreferenceStore } from './notify';

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
