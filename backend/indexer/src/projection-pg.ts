/**
 * Postgres executor for `projectEvent`'s operation list. Same operations,
 * same order, as `MemoryProjection` — the semantics live in
 * `projection.ts`; this file only translates each mechanical op to SQL.
 * Runs on the SAME client (transaction) as the ledger append.
 *
 * Tables: backend/_shared/migrations/0003_derived_tables.sql.
 */

import type { Queryable } from './shared';
import { projectEvent, type Projection } from './projection';
import type { DecodedEvent } from './shared';

const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`bad identifier: ${name}`);
  return name;
}

export class PgProjection implements Projection {
  constructor(private readonly db: Queryable) {}

  async apply(event: DecodedEvent): Promise<void> {
    for (const op of projectEvent(event)) {
      switch (op.kind) {
        case 'upsert': {
          const keyCols = Object.keys(op.key).map(ident);
          const setCols = Object.keys(op.set).map(ident);
          const cols = [...keyCols, ...setCols];
          const values = [...Object.values(op.key), ...Object.values(op.set)];
          const params = cols.map((_, i) => `$${i + 1}`);
          const updates = setCols.map((c) => `${c} = EXCLUDED.${c}`);
          await this.db.query(
            `INSERT INTO ${ident(op.table)} (${cols.join(', ')})
             VALUES (${params.join(', ')})
             ON CONFLICT (${keyCols.join(', ')}) DO UPDATE SET ${
               updates.length ? updates.join(', ') : `${keyCols[0]} = EXCLUDED.${keyCols[0]}`
             }`,
            values as unknown[]
          );
          break;
        }
        case 'increment': {
          const keyCols = Object.keys(op.key).map(ident);
          const field = ident(op.field);
          const params = keyCols.map((_, i) => `$${i + 1}`);
          await this.db.query(
            `INSERT INTO ${ident(op.table)} (${keyCols.join(', ')}, ${field})
             VALUES (${params.join(', ')}, $${keyCols.length + 1})
             ON CONFLICT (${keyCols.join(', ')}) DO UPDATE
               SET ${field} = COALESCE(${ident(op.table)}.${field}, 0) + EXCLUDED.${field}`,
            [...Object.values(op.key), op.by]
          );
          break;
        }
        case 'min': {
          const keyCols = Object.keys(op.key).map(ident);
          const field = ident(op.field);
          const params = keyCols.map((_, i) => `$${i + 1}`);
          await this.db.query(
            `INSERT INTO ${ident(op.table)} (${keyCols.join(', ')}, ${field})
             VALUES (${params.join(', ')}, $${keyCols.length + 1})
             ON CONFLICT (${keyCols.join(', ')}) DO UPDATE
               SET ${field} = LEAST(COALESCE(${ident(op.table)}.${field}, EXCLUDED.${field}), EXCLUDED.${field})`,
            [...Object.values(op.key), op.value]
          );
          break;
        }
        case 'close_if_fully_refunded': {
          await this.db.query(
            `UPDATE pools SET state = 'Closed'
              WHERE pool = $1 AND entrants > 0 AND refunded_count >= entrants`,
            [op.pool]
          );
          break;
        }
      }
    }
  }

  async reset(): Promise<void> {
    await this.db.query(
      'TRUNCATE pools, entries, results, payouts, profiles'
    );
  }
}
