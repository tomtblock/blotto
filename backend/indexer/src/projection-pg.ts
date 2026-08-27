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
        case 'history_on_entry': {
          // Fill-missing semantics, mirroring MemoryProjection: identity
          // fields land only where the row does not already carry a value
          // (a replayed PrizesPaid may have created the row first).
          await this.db.query(
            `INSERT INTO player_history
               (pool, player, seat, tier, pot_lamports, entries_to_date)
             SELECT $1, $2, $3::int, p.tier, p.pot_lamports,
                    COALESCE(pr.pools_entered, 1)
               FROM (SELECT 1) one
               LEFT JOIN pools p ON p.pool = $1
               LEFT JOIN profiles pr ON pr.player = $2
             ON CONFLICT (pool, player) DO UPDATE SET
               seat = COALESCE(player_history.seat, EXCLUDED.seat),
               tier = COALESCE(player_history.tier, EXCLUDED.tier),
               pot_lamports = COALESCE(player_history.pot_lamports, EXCLUDED.pot_lamports),
               entries_to_date = CASE
                 WHEN player_history.entries_to_date = 0 THEN EXCLUDED.entries_to_date
                 ELSE player_history.entries_to_date
               END`,
            [op.pool, op.player, op.seat]
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
        case 'paid_if_fully_settled': {
          // The mask is a u64 seat bitmask (NUMERIC in SQL, bigints as
          // decimal strings end-to-end); the bit test runs in SQL so both
          // executors implement the same rule against their own `results`.
          await this.db.query('UPDATE pools SET paid_mask = $2 WHERE pool = $1', [
            op.pool,
            op.mask,
          ]);
          await this.db.query(
            `UPDATE pools SET state = 'Paid'
              WHERE pool = $1
                AND EXISTS (SELECT 1 FROM results r WHERE r.pool = $1)
                AND NOT EXISTS (
                  SELECT 1 FROM results r
                   WHERE r.pool = $1
                     AND floor($2::numeric / (2::numeric ^ r.seat)) % 2 = 0
                )`,
            [op.pool, op.mask]
          );
          break;
        }
      }
    }
  }

  async reset(): Promise<void> {
    await this.db.query(
      'TRUNCATE pools, entries, results, payouts, profiles, player_history'
    );
  }
}
