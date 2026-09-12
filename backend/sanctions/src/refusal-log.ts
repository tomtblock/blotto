/**
 * The durable record of a screening REFUSAL (audit 2026-09-11, B-36).
 *
 * WHAT WAS WRONG. A wallet on a published sanctions list was refused a
 * packet, and the only trace was one line on standard output —
 * `packet refused: sanctions` beside a two-octet IP prefix, with no wallet,
 * no list name, and nothing written to any store. A refused entry is the one
 * event a regulator asks about by name, and ours survived only as long as the
 * platform's log retention.
 *
 * WHAT IS KEPT, AND WHY EACH FIELD (the privacy posture matters here — this
 * repository truncates IP addresses in its logs on purpose, and a store that
 * outlives a log should not quietly widen what is held):
 *
 *   wallet        IN FULL. A public key, and the SUBJECT of the decision. A
 *                 record that cannot say who was refused answers nothing.
 *   pool          IN FULL. A public PDA; says which entry this was.
 *   matches       The list each source matched, the party it named, and that
 *                 source's own identifier for the listing. This is the
 *                 evidence: "which list matched" is the first question.
 *   consulted /   Which sources answered and which failed, so a refusal
 *   failed        decided on one source with two others down is legible
 *                 afterwards rather than looking like a unanimous verdict.
 *   screenedAt    The vendor verdict's own timestamp, not ours.
 *   country       What the geo lookup returned for the request. An input to
 *                 the decision, and two alpha characters.
 *   ipPrefix      TRUNCATED — the first two octets of a v4 address or the
 *                 first hextet of a v6, exactly as `service.ts` truncates it
 *                 for the log. Enough to correlate the refusal with the
 *                 request in the logs of the same run; not a whole address
 *                 held indefinitely in a table. Nothing in the decision reads
 *                 the remaining octets, so keeping them would be collection
 *                 for its own sake.
 *
 * What is NOT kept: any score (none exists — `seam.ts`), the allocation, the
 * signature, headers, or a device identifier. A sanctions record is not a
 * general request log and must not become one.
 *
 * RETENTION is an operator and counsel question, not a code one: the table is
 * append-only and nothing here deletes from it. Migration 0019's header says
 * the same to whoever sets a policy.
 */

/** One matched listing, flattened from the verdict. */
export interface RefusalMatch {
  readonly source: string;
  readonly listName: string;
  readonly entityName: string;
  readonly entityId?: string;
}

/** One refused entry, as it is stored. */
export interface SanctionsRefusalRecord {
  /** Which service refused — `packet` at entry today. */
  readonly service: string;
  readonly wallet: string;
  readonly pool: string;
  /** ISO-8601, from the verdict. */
  readonly screenedAt: string;
  readonly matches: readonly RefusalMatch[];
  readonly consulted: readonly string[];
  readonly failed: readonly string[];
  /** ISO 3166-1 alpha-2 from the geo lookup, or null when it did not answer. */
  readonly country: string | null;
  /** The TRUNCATED client address — see this file's header. */
  readonly ipPrefix: string | null;
}

/** Where a refusal is written. Throws are the caller's to handle. */
export interface SanctionsRefusalLog {
  record(refusal: SanctionsRefusalRecord): Promise<void>;
}

/** In-memory log — tests, and any deployment with no database configured. */
export class MemorySanctionsRefusalLog implements SanctionsRefusalLog {
  readonly records: SanctionsRefusalRecord[] = [];
  async record(refusal: SanctionsRefusalRecord): Promise<void> {
    this.records.push(refusal);
  }
}

/**
 * The narrow query surface, declared structurally so this package keeps its
 * zero dependencies — `pg.Pool` and a `PoolClient` both satisfy it, and
 * `backend/packet/src/stores-pg.ts` declares the same shape for the same
 * reason.
 */
export interface Queryable {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: unknown[] }>;
}

/** Postgres log — `sanctions_refusals`, migration 0019. */
export class PgSanctionsRefusalLog implements SanctionsRefusalLog {
  constructor(private readonly db: Queryable) {}

  async record(refusal: SanctionsRefusalRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO sanctions_refusals
         (service, wallet, pool, screened_at, matches, consulted, failed, country, ip_prefix)
       VALUES ($1, $2, $3, $4::timestamptz, $5::jsonb, $6, $7, $8, $9)`,
      [
        refusal.service,
        refusal.wallet,
        refusal.pool,
        refusal.screenedAt,
        JSON.stringify(refusal.matches),
        [...refusal.consulted],
        [...refusal.failed],
        refusal.country,
        refusal.ipPrefix,
      ]
    );
  }
}
