/**
 * The derived-table projection (roadmap 2.5, R15) — `pools`, `entries`,
 * `results`, `payouts`, `profiles` as a PURE FUNCTION of the event ledger.
 *
 * The ledger stays the single source of truth: every rule here is expressed
 * by `projectEvent`, which turns one decoded event into a list of mechanical
 * operations (upsert / increment / min / one named conditional). Both
 * implementations — the in-memory reference and Postgres — EXECUTE the same
 * operation list, so their semantics cannot drift apart rule by rule; and
 * `rederive()` rebuilds every table from the ledger alone, which is the
 * property that keeps a derived row from quietly becoming a second source
 * of truth.
 *
 * Profiles (R15): a lifetime, read-only record — pools entered, prize totals,
 * best rank, the cosmetic class collection. Nothing here can affect a pool.
 */

import type { DecodedEvent } from './shared';

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export type ProjectionOp =
  | {
      kind: 'upsert';
      table: 'pools' | 'entries' | 'results' | 'payouts' | 'profiles';
      key: Record<string, string | number>;
      set: Record<string, unknown>;
    }
  | {
      kind: 'increment';
      table: 'pools' | 'entries' | 'profiles';
      key: Record<string, string | number>;
      field: string;
      /** Decimal string — increments are numeric and may exceed 2^53. */
      by: string;
    }
  | {
      kind: 'min';
      table: 'profiles';
      key: Record<string, string | number>;
      field: string;
      value: number;
    }
  | {
      /** `pools.state = 'Closed'` once `refunded_count >= entrants`. */
      kind: 'close_if_fully_refunded';
      pool: string;
    };

/** Map one decoded event to its projection operations. Unknown events: []. */
export function projectEvent(e: DecodedEvent): ProjectionOp[] {
  switch (e.event) {
    case 'PoolOpened':
      return [
        {
          kind: 'upsert',
          table: 'pools',
          key: { pool: e.pool as string },
          set: {
            id: e.id,
            tier: e.tier,
            entry_lamports: e.entry_lamports,
            fill_deadline: e.fill_deadline,
            timer_seconds: e.timer_seconds,
            sealing_pubkey: e.sealing_pubkey,
            sealing_secret_hash: e.sealing_secret_hash,
            state: 'Open',
            entrants: 0,
            paid_mask: 0,
            refunded_count: 0,
          },
        },
      ];
    case 'PoolVrfSeeded':
      return [
        {
          kind: 'upsert',
          table: 'pools',
          key: { pool: e.pool as string },
          set: { vrf_seed: e.vrf_seed },
        },
      ];
    case 'PassCollectionCreated':
      return [
        {
          kind: 'upsert',
          table: 'pools',
          key: { pool: e.pool as string },
          set: { pass_collection: e.pass_collection },
        },
      ];
    case 'EntryRegistered': {
      const cls = e.class as number;
      return [
        {
          kind: 'upsert',
          table: 'entries',
          key: { pool: e.pool as string, player: e.player as string },
          set: {
            idx: e.index,
            battles_hash: e.battles_hash,
            class: cls,
            slot_hash: e.slot_hash,
            pass_asset: e.pass_asset,
            flagged: false,
            refunded: false,
            escrow_settled: null,
          },
        },
        {
          kind: 'increment',
          table: 'pools',
          key: { pool: e.pool as string },
          field: 'entrants',
          by: '1',
        },
        {
          kind: 'increment',
          table: 'profiles',
          key: { player: e.player as string },
          field: 'pools_entered',
          by: '1',
        },
        {
          kind: 'increment',
          table: 'profiles',
          key: { player: e.player as string },
          field: `class_${cls}`,
          by: '1',
        },
      ];
    }
    case 'PoolSealed':
      return [
        {
          kind: 'upsert',
          table: 'pools',
          key: { pool: e.pool as string },
          set: { state: 'Sealed', entrants: e.entrants },
        },
      ];
    case 'PoolSecretRevealed':
      return [
        {
          kind: 'upsert',
          table: 'pools',
          key: { pool: e.pool as string },
          set: { secret: e.secret },
        },
      ];
    case 'ResultsCommitted': {
      const ops: ProjectionOp[] = [
        {
          kind: 'upsert',
          table: 'pools',
          key: { pool: e.pool as string },
          set: { results_root: e.root, state: 'Scored' },
        },
      ];
      (e.winners as string[]).forEach((player, i) => {
        ops.push({
          kind: 'upsert',
          table: 'results',
          key: { pool: e.pool as string, rank: i + 1 },
          set: { player },
        });
      });
      return ops;
    }
    case 'PrizesPaid': {
      const ops: ProjectionOp[] = [];
      for (const p of e.payouts as Array<{
        player: string;
        rank: number;
        amount: string;
        escrowed: boolean;
      }>) {
        ops.push({
          kind: 'upsert',
          table: 'payouts',
          key: { pool: e.pool as string, rank: p.rank },
          set: { player: p.player, amount: p.amount, escrowed: p.escrowed },
        });
        ops.push({
          kind: 'increment',
          table: 'profiles',
          key: { player: p.player },
          field: 'ranks_paid',
          by: '1',
        });
        ops.push({
          kind: 'min',
          table: 'profiles',
          key: { player: p.player },
          field: 'best_rank',
          value: p.rank,
        });
        if (!p.escrowed) {
          ops.push({
            kind: 'increment',
            table: 'profiles',
            key: { player: p.player },
            field: 'total_won_lamports',
            by: p.amount,
          });
        }
      }
      const mask = e.paid_mask as number;
      ops.push({
        kind: 'upsert',
        table: 'pools',
        key: { pool: e.pool as string },
        set: mask === 0xffff ? { paid_mask: mask, state: 'Paid' } : { paid_mask: mask },
      });
      return ops;
    }
    case 'EntryFlagged':
      return [
        {
          kind: 'upsert',
          table: 'entries',
          key: { pool: e.pool as string, player: e.player as string },
          set: { flagged: e.flagged },
        },
      ];
    case 'EscrowReleased':
      return [
        {
          kind: 'upsert',
          table: 'entries',
          key: { pool: e.pool as string, player: e.player as string },
          set: { escrow_settled: 'released' },
        },
        {
          kind: 'increment',
          table: 'profiles',
          key: { player: e.player as string },
          field: 'total_won_lamports',
          by: e.amount as string,
        },
      ];
    case 'EscrowForfeited':
      return [
        {
          kind: 'upsert',
          table: 'entries',
          key: { pool: e.pool as string, player: e.player as string },
          set: { escrow_settled: 'forfeited' },
        },
      ];
    case 'RefundTriggered':
      return [
        {
          kind: 'upsert',
          table: 'pools',
          key: { pool: e.pool as string },
          set: { state: (e.entrants as number) === 0 ? 'Closed' : 'Refunding' },
        },
      ];
    case 'Refunded':
      return [
        {
          kind: 'upsert',
          table: 'entries',
          key: { pool: e.pool as string, player: e.player as string },
          set: { refunded: true },
        },
        {
          kind: 'increment',
          table: 'pools',
          key: { pool: e.pool as string },
          field: 'refunded_count',
          by: '1',
        },
        { kind: 'close_if_fully_refunded', pool: e.pool as string },
      ];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// The projection seam + the in-memory reference
// ---------------------------------------------------------------------------

export interface Projection {
  apply(event: DecodedEvent): Promise<void>;
  /** Drop every derived row (the start of a re-derive). */
  reset(): Promise<void>;
}

type Row = Record<string, unknown>;

/** In-memory projection — the reference semantics the Postgres one matches. */
export class MemoryProjection implements Projection {
  private tables = new Map<string, Map<string, Row>>();

  private table(name: string): Map<string, Row> {
    let t = this.tables.get(name);
    if (!t) {
      t = new Map();
      this.tables.set(name, t);
    }
    return t;
  }

  private static rowKey(key: Record<string, string | number>): string {
    return Object.keys(key)
      .sort()
      .map((k) => `${k}=${key[k]}`)
      .join('|');
  }

  async apply(event: DecodedEvent): Promise<void> {
    for (const op of projectEvent(event)) {
      switch (op.kind) {
        case 'upsert': {
          const t = this.table(op.table);
          const k = MemoryProjection.rowKey(op.key);
          t.set(k, { ...(t.get(k) ?? {}), ...op.key, ...op.set });
          break;
        }
        case 'increment': {
          const t = this.table(op.table);
          const k = MemoryProjection.rowKey(op.key);
          const row = t.get(k) ?? { ...op.key };
          const current = BigInt((row[op.field] as string | number | undefined) ?? 0);
          row[op.field] = (current + BigInt(op.by)).toString();
          t.set(k, row);
          break;
        }
        case 'min': {
          const t = this.table(op.table);
          const k = MemoryProjection.rowKey(op.key);
          const row = t.get(k) ?? { ...op.key };
          const current = row[op.field] as number | undefined;
          row[op.field] = current === undefined ? op.value : Math.min(current, op.value);
          t.set(k, row);
          break;
        }
        case 'close_if_fully_refunded': {
          const t = this.table('pools');
          const k = MemoryProjection.rowKey({ pool: op.pool });
          const row = t.get(k);
          if (row) {
            const refunded = BigInt((row.refunded_count as string | number | undefined) ?? 0);
            const entrants = BigInt((row.entrants as string | number | undefined) ?? 0);
            if (entrants > 0n && refunded >= entrants) row.state = 'Closed';
          }
          break;
        }
      }
    }
  }

  async reset(): Promise<void> {
    this.tables.clear();
  }

  /** Deep, sorted snapshot for tests — two identical projections compare equal. */
  snapshot(): Record<string, Record<string, Row>> {
    const out: Record<string, Record<string, Row>> = {};
    for (const [name, t] of [...this.tables.entries()].sort()) {
      out[name] = {};
      for (const [k, row] of [...t.entries()].sort()) {
        out[name][k] = { ...row };
      }
    }
    return out;
  }
}
